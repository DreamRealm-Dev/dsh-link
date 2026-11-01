/**
 * The panel WORLD helpers a gate can ask for by name.
 *
 * R356/R359: `panel-surface` measures the native panel against the rectangle the browser pane asks to have filled, so its
 * premise is a pane that is OPEN. The door is the rail own 新标签页 button followed by the browser item in its menu.
 *
 * Both clicks are written as FUNCTIONS and sent with `.toString()`, never as hand-escaped selector strings: the first
 * version built the click with a `replace()` on a quoted expression, the evaluate threw "Uncaught", and the menu never
 * opened (traced: add-click value=null exception=Uncaught, then a menu that still listed the app launcher rather than tab
 * kinds). Passing a function body has no quoting to get wrong.
 */

const addTabClick = function () {
  var button = document.querySelector('[aria-label="新标签页"]')
  if (button === null) return 'no-add-button'
  button.click()
  return 'add-clicked'
}

const browserItemClick = function () {
  var items = Array.prototype.slice.call(document.querySelectorAll('button, [role="menuitem"]'))
  var hit = items.filter(function (el) { return /浏览器/.test(String(el.textContent || '')) })[0]
  if (hit === undefined) return 'no-browser-item'
  hit.click()
  return 'item-clicked'
}

const anchorCountExpr = function () { return document.querySelectorAll('[data-dsh-link-surface]').length }

async function anchorCount(cdp) {
  const probe = await cdp.evaluate('(' + anchorCountExpr.toString() + ')()').catch(() => null)
  if (probe === null || probe === undefined || probe.exception !== undefined && probe.exception !== null) return 0
  return typeof probe.value === 'number' ? probe.value : 0
}

const closeBrowserPaneClick = function () {
  var rail = document.querySelector('[data-rightbar-col]')
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'))
  var tabs_ = tabs.filter(function (el) { return rail !== null && rail.contains(el) && /浏览器/.test(String(el.textContent || '')) })
  var closed = 0
  tabs_.forEach(function (tab) {
    var shut = tab.querySelector('[data-dockkit-tab-close], [aria-label="关闭"]')
    if (shut !== null) { shut.click(); closed += 1 }
  })
  return closed
}

/** Close the rail browser pane when it is open, so a gate that needs it AWAY starts from a pane-less rail. */
export const closeBrowserPane = async (port, cdpPort = 9222) => {
  const { connect } = await import('./cdp-drive.mjs')
  const cdp = await connect({ port: cdpPort })
  // Same rule as openBrowserPane: the socket is closed on every path (R362).
  try {
    const before = await cdp.evaluate('(' + anchorCountExpr.toString() + ')()').catch(() => null)
    const anchors = before !== null && before !== undefined && typeof before.value === 'number' ? before.value : 0
    if (anchors === 0) return { closed: false, anchors }
    const shut = await cdp.evaluate('(' + closeBrowserPaneClick.toString() + ')()').catch(() => null)
    const closed = shut !== null && shut !== undefined && typeof shut.value === 'number' ? shut.value : 0
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
      const now = await cdp.evaluate('(' + anchorCountExpr.toString() + ')()').catch(() => null)
      const count = now !== null && now !== undefined && typeof now.value === 'number' ? now.value : null
      if (count === 0) return { closed: true, anchors: 0, tabs: closed }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return { closed: true, anchors: null, tabs: closed }
  } finally {
    try { cdp.close() } catch (ignored) { /* already closed */ }
  }
}

const parkAwayClick = function () {
  var rail = document.querySelector('[data-rightbar-col]')
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'))
  var inRail = tabs.filter(function (el) { return rail !== null && rail.contains(el) })
  var isBrowser = function (el) { return /浏览器/.test(String(el.textContent || '')) }
  var selected = inRail.filter(function (el) { return el.getAttribute('aria-selected') === 'true' })[0]
  if (selected !== undefined && isBrowser(selected) === false) return 'already-away'
  // R373: never park onto the GUIDE tab ("开始"): opening it leaves a chip this gate cannot put back, and the restore
  // judge then compares a 3-chip rail with a 2-chip one. Measured in a transcript: entry ["智能体团队","🌐浏览器","开始"],
  // exit ["智能体团队","🌐浏览器"].
  var isGuide = function (el) { return /开始|Guide/.test(String(el.textContent || '')) }
  // R373: skip the guide when there IS another tab, but fall back to it - a prep that refuses to park at all leaves the next
  // gate restoring whatever the previous one left (measured: contribution-render reading 7 went red the moment this returned
  // already-away). The guide chip insight is recorded in the delivery page instead of enforced here.
  var target = inRail.filter(function (el) { return isBrowser(el) === false && isGuide(el) === false })[0]
  if (target === undefined) target = inRail.filter(function (el) { return isBrowser(el) === false })[0]
  if (target === undefined) return 'no-away-tab'
  target.click()
  return 'parked'
}

const pressRailTabByText = function (label) {
  var rail = document.querySelector('[data-rightbar-col]')
  if (rail === null) return 'no-rail'
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-dockkit-tab]'))
  var hit = tabs.filter(function (el) { return rail.contains(el) && String(el.textContent || '').indexOf(label) !== -1 })[0]
  if (hit === undefined) return 'no-tab'
  hit.click()
  return 'pressed'
}

const pressGuideCapsuleByText = function (label) {
  var bodies = Array.prototype.slice.call(document.querySelectorAll('[data-sidebar-right-tab]'))
    .filter(function (el) { return String(el.className || '').indexOf('tabBody') !== -1 })
  var shown = bodies.filter(function (el) { var box = el.getBoundingClientRect(); return box.width > 8 && box.height > 8 })
  var body = shown[0] || bodies[0]
  if (body === undefined) return 'no-body'
  var all = Array.prototype.slice.call(body.querySelectorAll('*'))
  var leaf = all.filter(function (el) { return el.children.length === 0 && String(el.textContent || '').indexOf(label) !== -1 })[0]
  if (leaf === undefined) return 'no-capsule'
  var target = leaf
  for (var step = 0; step < 6 && target !== null; step += 1) {
    if (String(target.tagName || '') === 'BUTTON' || target.getAttribute('role') === 'button') break
    target = target.parentElement
  }
  if (target === null) return 'no-button'
  target.click()
  return 'pressed'
}

const browserChipCount = function () {
  var rail = document.querySelector('[data-rightbar-col]')
  if (rail === null) return -1
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-dockkit-tab]'))
  return tabs.filter(function (el) { return rail.contains(el) && /浏览器/.test(String(el.textContent || '')) }).length
}

/** How many rail chips are titled like the browser tab type. */
const countBrowserChips = async (cdpPort) => {
  const { connect } = await import('./cdp-drive.mjs')
  const cdp = await connect({ port: cdpPort })
  try {
    const answer = await cdp.evaluate('(' + browserChipCount.toString() + ')()').catch(() => null)
    return answer !== null && answer !== undefined && typeof answer.value === 'number' ? answer.value : -1
  } finally {
    try { cdp.close() } catch (ignored) { /* already closed */ }
  }
}

const railPanelHidden = function () {
  var panel = document.querySelector('[data-sidebar-right-panel]')
  return panel === null ? null : panel.getAttribute('aria-hidden') === 'true'
}

const pressOpenRail = function () {
  var button = Array.prototype.slice.call(document.querySelectorAll('button[aria-label]'))
    .filter(function (el) { return /打开右侧边栏/.test(String(el.getAttribute('aria-label'))) })[0]
  if (button === undefined) return 'already-open'
  button.click()
  return 'pressed'
}

const pressCollapseRail = function () {
  var button = Array.prototype.slice.call(document.querySelectorAll('button[aria-label]'))
    .filter(function (el) { return /收起右侧边栏/.test(String(el.getAttribute('aria-label'))) })[0]
  if (button === undefined) return 'no-control'
  button.click()
  return 'pressed'
}

const railChipCount = function () {
  var rail = document.querySelector('[data-rightbar-col]')
  if (rail === null) return -1
  return Array.prototype.slice.call(document.querySelectorAll('[data-dockkit-tab]')).filter(function (el) { return rail.contains(el) }).length
}

/**
 * Make sure the shipped guide stands in the rail, re-seeding it when the pane is empty.
 *
 * R377: closing the LAST chip leaves the rail empty and nothing brings the guide back on its own - measured twice: the
 * pane stayed at [] for six seconds, and a collapse/expand pair returned ["开始"] immediately. That pair is the shipped
 * control, so it is what this uses.
 * @param cdpPort - the CDP port of the shell own page.
 * @returns the chips it found and the chips it left.
 */
export const ensureGuidePresent = async (cdpPort = 9222) => {
  const { connect } = await import('./cdp-drive.mjs')
  const cdp = await connect({ port: cdpPort })
  try {
    const before = await cdp.evaluate('(' + railChipCount.toString() + ')()').catch(() => null)
    const count = before === null || before === undefined ? -1 : before.value
    if (typeof count === 'number' && count > 0) return { reseeded: false, chips: count }
    const collapse = await cdp.evaluate('(' + pressCollapseRail.toString() + ')()').catch(() => null)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const expand = await cdp.evaluate('(' + pressOpenRail.toString() + ')()').catch(() => null)
    const deadline = Date.now() + 6000
    let chips = -1
    while (Date.now() < deadline) {
      const probe = await cdp.evaluate('(' + railChipCount.toString() + ')()').catch(() => null)
      chips = probe === null || probe === undefined ? -1 : probe.value
      if (typeof chips === 'number' && chips > 0) break
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    return { reseeded: true, collapse: collapse === null ? null : collapse.value, expand: expand === null ? null : expand.value, chips }
  } finally {
    try { cdp.close() } catch (ignored) { /* already closed */ }
  }
}

/**
 * Expand the right rail when it sits collapsed.
 *
 * R377: a collapsed rail renders NO chips and no guide, so every prep that looks for a chip saw an empty world and gave
 * up - measured: \`(away world for panel-action-render: parked=no-away-tab anchors=null)\` while the panel was simply
 * \`aria-hidden="true"\`, and pressing 打开右侧边栏 brought the guide straight back.
 * @param cdpPort - the CDP port of the shell own page.
 * @returns whether it had to press anything.
 */
export const ensureRailExpanded = async (cdpPort = 9222) => {
  const { connect } = await import('./cdp-drive.mjs')
  const cdp = await connect({ port: cdpPort })
  try {
    const hidden = await cdp.evaluate('(' + railPanelHidden.toString() + ')()').catch(() => null)
    if (hidden === null || hidden === undefined || hidden.value !== true) return { wasCollapsed: false, pressed: 'no' }
    const press = await cdp.evaluate('(' + pressOpenRail.toString() + ')()').catch(() => null)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    return { wasCollapsed: true, pressed: press === null ? null : press.value }
  } finally {
    try { cdp.close() } catch (ignored) { /* already closed */ }
  }
}

const pressPanelAction = function (label) {
  var buttons = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"]'))
  var hit = buttons.filter(function (el) { return String(el.textContent || '').indexOf(label) !== -1 })[0]
  if (hit === undefined) return 'no-action'
  hit.click()
  return 'pressed'
}

/**
 * Build a two-chip rail from the guide-only world, through the LINK panel's own action row.
 *
 * R377: the away world needs a browser CHIP with the browser pane CLOSED, and from a guide-only rail there is no way to
 * reach two chips - a capsule REPLACES the guide, and the strip's add control exists only on an empty pane. Measured
 * route (the same one a person uses): the guide lists LINK 面板; our panel carries the action another package declared;
 * pressing it opens the browser tab in the same pane, so the rail goes ["LINK 面板"] -> ["LINK 面板", "🌐浏览器"].
 * @param cdpPort - the CDP port of the shell own page.
 * @param panelCapsule - the label of this project's panel entry in the guide.
 * @param actionLabel - the action row inside that panel that opens the browser pane.
 * @returns the named result of each step and the chips it left.
 */
export const openBrowserThroughPanelAction = async (cdpPort = 9222, panelCapsule = 'LINK', actionLabel = '打开浏览器面板') => {
  const { connect } = await import('./cdp-drive.mjs')
  const cdp = await connect({ port: cdpPort })
  try {
    const guide = await cdp.evaluate('(' + pressRailTabByText.toString() + ')("开始")').catch(() => null)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const capsule = await cdp.evaluate('(' + pressGuideCapsuleByText.toString() + ')(' + JSON.stringify(panelCapsule) + ')').catch(() => null)
    let action = null
    const waitForRow = Date.now() + 6000
    while (Date.now() < waitForRow) {
      const probe = await cdp.evaluate('(' + pressPanelAction.toString() + ')(' + JSON.stringify(actionLabel) + ')').catch(() => null)
      action = probe === null ? null : probe.value
      if (action === 'pressed') break
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const chips = await cdp.evaluate('(' + browserChipCount.toString() + ')()').catch(() => null)
    return { guide: guide === null ? null : guide.value, capsule: capsule === null ? null : capsule.value, action, browserChips: chips === null ? null : chips.value }
  } finally {
    try { cdp.close() } catch (ignored) { /* already closed */ }
  }
}

/**
 * Open the browser tab from the GUIDE's own capsule list.
 *
 * R377: the away world needs a browser CHIP in the rail with the pane closed, and \`openBrowserPane\` reaches one through
 * the strip's add control - which exists only on an EMPTY pane. A pane holding the shipped guide (the state the gate
 * before this one leaves behind, and the state any normal work leaves) has no add control at all, so the prep used to
 * give up and the gate then read "no rail chip is titled like the browser half own tab.title: the chips are
 * ["LINK 面板"]". The guide's capsule list is the same door a person uses for exactly this.
 * @param cdpPort - the CDP port of the shell own page.
 * @returns the named result of each step.
 */
const openBrowserFromGuide = async (cdpPort) => {
  const { connect } = await import('./cdp-drive.mjs')
  const cdp = await connect({ port: cdpPort })
  try {
    const guide = await cdp.evaluate('(' + pressRailTabByText.toString() + ')("开始")').catch(() => null)
    await new Promise((resolve) => setTimeout(resolve, 900))
    const capsule = await cdp.evaluate('(' + pressGuideCapsuleByText.toString() + ')("浏览器")').catch(() => null)
    const deadline = Date.now() + 6000
    let chips = -1
    while (Date.now() < deadline) {
      const probe = await cdp.evaluate('(' + browserChipCount.toString() + ')()').catch(() => null)
      chips = probe !== null && probe !== undefined && typeof probe.value === 'number' ? probe.value : -1
      if (chips > 0) break
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    return { guide: guide === null ? null : guide.value, capsule: capsule === null ? null : capsule.value, chips }
  } finally {
    try { cdp.close() } catch (ignored) { /* already closed */ }
  }
}

/**
 * Put the rail in the AWAY world for a gate that measures "the press opens the browser pane":
 * the native panel closed, and the rail on a tab that is NOT the browser - while the browser CHIP stays in the rail.
 *
 * R363: closing the browser tab (what the first version did) removes the chip too, and `panel-action-render` reading 4 then
 * fails with "no rail chip is titled like the browser half own tab.title" - it needs a chip to press. Parking keeps it.
 */
export const parkAwayFromBrowserPane = async (port, cdpPort = 9222, options = {}) => {
  // R377: a COLLAPSED rail renders no chips at all, so every chip-shaped check below would see an empty world.
  await ensureRailExpanded(cdpPort)
  // R365: a chip has to EXIST for the gate to press - so this opens the browser pane first when the rail has none, then
  // parks away from it. Measured: after the gates before it closed the pane they opened, the chips were
  // ["智能体团队","LINK 面板"] and reading 4 failed on exactly that.
  const existing = await (async () => {
    const { connect } = await import('./cdp-drive.mjs')
    const cdp = await connect({ port: cdpPort })
    try {
      const probe = await cdp.evaluate('(function () { var rail = document.querySelector(\'[data-rightbar-col]\'); var tabs = Array.prototype.slice.call(document.querySelectorAll(\'[role="tab"]\')); return tabs.filter(function (el) { return rail !== null && rail.contains(el) && /浏览器/.test(String(el.textContent || \'\')) }).length })()').catch(() => null)
      return probe !== null && probe !== undefined && typeof probe.value === 'number' ? probe.value : 0
    } finally {
      try { cdp.close() } catch (ignored) { /* already closed */ }
    }
  })()
  if (existing === 0) {
    // R377: an empty rail has neither a chip nor a guide; the collapse/expand pair is what re-seeds the guide, and the
    // guide is the door the two fallbacks below use.
    if (await countBrowserChips(cdpPort) === 0) await ensureGuidePresent(cdpPort)
    await openBrowserPane(port, cdpPort, { waitMs: 6000 })
    // R377: the add control exists only on an EMPTY pane. A pane holding the guide (the state the gate before this one
    // leaves, and the state normal work leaves) has none, so the same tab is opened from the guide's own capsule list.
    // R377: from a GUIDE-ONLY rail the capsule door leaves a SINGLE chip, which is not an away world - parking needs a
    // non-browser chip to park ON. So the door that builds TWO chips is tried first: the LINK panel's own action row
    // opens the browser tab beside the panel (measured ["LINK 面板"] -> ["LINK 面板", "🌐浏览器"]), and only if that
    // fails does the plain capsule door run.
    if (await countBrowserChips(cdpPort) === 0) await openBrowserThroughPanelAction(cdpPort)
    if (await countBrowserChips(cdpPort) === 0) await openBrowserFromGuide(cdpPort)
  }
  const { connect } = await import('./cdp-drive.mjs')
  const cdp = await connect({ port: cdpPort })
  try {
    await fetch('http://127.0.0.1:' + String(port) + '/__shell/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'close' }) }).catch(() => null)
    const parked = await cdp.evaluate('(' + parkAwayClick.toString() + ')()').catch(() => null)
    const action = parked !== null && parked !== undefined ? parked.value : null
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const probe = await cdp.evaluate('(' + anchorCountExpr.toString() + ')()').catch(() => null)
      const anchors = probe !== null && probe !== undefined && typeof probe.value === 'number' ? probe.value : null
      if (anchors === 0) return { parked: action, anchors: 0 }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return { parked: action, anchors: null }
  } finally {
    try { cdp.close() } catch (ignored) { /* already closed */ }
  }
}

const tokenExpr = function () { return String((window.__DSH_LAN_BRIDGE_UI__ && window.__DSH_LAN_BRIDGE_UI__.token) || '') }

/**
 * Turn the LIVE shell bridge announce on or off.
 *
 * R368: two gates want OPPOSITE worlds and both were prepared by hand: `lan-bridge-discovery-live` needs this machine
 * announcing, while `verify-interconnect` own reclaim suite times out while the live bridge announces itself (measured
 * R318-R320). Declaring the state as a prep is what lets both run in one suite.
 *
 * The token is read from the page (it lives there), but the CALL is made from Node: one small evaluate for a string beats
 * an escaped fetch expression inside an evaluate (the first version reported answer=null and could not say why).
 */
export const setBridgeDiscovery = async (port, cdpPort = 9222, enabled = true) => {
  const { connect } = await import('./cdp-drive.mjs')
  const cdp = await connect({ port: cdpPort })
  let token = ''
  try {
    const read = await cdp.evaluate('(' + tokenExpr.toString() + ')()').catch(() => null)
    token = read !== null && read !== undefined && read.exception === undefined && typeof read.value === 'string' ? read.value : ''
  } finally {
    try { cdp.close() } catch (ignored) { /* already closed */ }
  }
  const answer = await fetch('http://127.0.0.1:' + String(port) + '/api/dsh-lan-bridge', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-DSH-Bridge-UI': token },
    body: JSON.stringify({ op: 'discover.set', args: { enabled: enabled === true } }),
  }).then(async (response) => ({ status: response.status, body: (await response.text()).slice(0, 160) })).catch((error) => ({ status: 0, body: String(error && error.message ? error.message : error) }))
  return { enabled, token: token === '' ? null : 'read', status: answer.status, answer: answer.body }
}

/** Park the rail on a NON-browser tab without touching the native panel: a deterministic entry for a gate whose restore
 * reading compares the world it found with the world it leaves. */
export const parkRailAway = async (port, cdpPort = 9222) => {
  const { connect } = await import('./cdp-drive.mjs')
  const cdp = await connect({ port: cdpPort })
  try {
    const parked = await cdp.evaluate('(' + parkAwayClick.toString() + ')()').catch(() => null)
    const action = parked !== null && parked !== undefined ? parked.value : null
    await new Promise((resolve) => setTimeout(resolve, 600))
    return { parked: action }
  } finally {
    try { cdp.close() } catch (ignored) { /* already closed */ }
  }
}
/**
 * Open the rail browser pane when it is not open, and wait for the surface it declares.
 * @param port - the shell port (kept so every world helper takes the same arguments).
 * @param cdpPort - the CDP port of the shell own page.
 * @returns opened, anchors, and the named result of each step it took.
 */
export const openBrowserPane = async (port, cdpPort = 9222, options = {}) => {
  const waitMs = options.waitMs === undefined ? 8000 : options.waitMs
  const { connect } = await import('./cdp-drive.mjs')
  const cdp = await connect({ port: cdpPort })
  // R362: the connection is CLOSED on every path. A second leaked CDP socket kept the gate own event loop alive, so the
  // gate printed its seven readings and then HUNG - the runner killed it at its 180 s gate timeout while the same gate
  // passed alone in 30 s. That is the whole of the runner-vs-standalone difference measured in R358.
  try {
    const before = await anchorCount(cdp)
    if (before > 0) return { opened: false, anchors: before }
    const steps = []
    const add = await cdp.evaluate('(' + addTabClick.toString() + ')()').catch((error) => ({ value: 'threw: ' + String(error && error.message ? error.message : error) }))
    steps.push({ step: 'add', value: add === null || add === undefined ? null : add.value })
    if (add === null || add === undefined || add.value !== 'add-clicked') return { opened: false, anchors: before, steps }
    await new Promise((resolve) => setTimeout(resolve, 900))
    const item = await cdp.evaluate('(' + browserItemClick.toString() + ')()').catch((error) => ({ value: 'threw: ' + String(error && error.message ? error.message : error) }))
    steps.push({ step: 'item', value: item === null || item === undefined ? null : item.value })
    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
      const now = await anchorCount(cdp)
      if (now > 0) return { opened: true, anchors: now, steps }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return { opened: true, anchors: 0, steps }
  } finally {
    try { cdp.close() } catch (ignored) { /* already closed */ }
  }
}

const closeEveryRailTab = function () {
  var rail = document.querySelector('[data-rightbar-col]')
  if (rail === null) return -1
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-dockkit-tab]'))
  var inRail = tabs.filter(function (el) { return rail.contains(el) })
  var closed = 0
  inRail.forEach(function (tab) {
    var shut = tab.querySelector('[data-dockkit-tab-close]')
    if (shut !== null) { shut.click(); closed += 1 }
  })
  return closed
}

const railChipsExpression = function () {
  var rail = document.querySelector('[data-rightbar-col]')
  if (rail === null) return JSON.stringify([])
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-dockkit-tab]'))
  return JSON.stringify(tabs.filter(function (el) { return rail.contains(el) }).map(function (el) { return String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24) }))
}

const surfaceCount = function () { return document.querySelectorAll('[data-dsh-link-surface]').length }

/**
 * Leave the world with the browser pane OPEN, walking the shipped doors in the order that works from any rail state.
 *
 * R377: the add control exists only on an EMPTY pane, so \`openBrowserPane\` cannot open anything from a rail that holds
 * the shipped guide - measured: \`(browser pane for panel-surface: opened=false anchors=0)\` and the gate then declined.
 * @param port - the shell port (kept so every world helper takes the same arguments).
 * @param cdpPort - the CDP port of the shell own page.
 * @returns which door was used and the surface count it left.
 */
export const ensureBrowserPane = async (port, cdpPort = 9222) => {
  await ensureRailExpanded(cdpPort)
  const anchors = async () => {
    const { connect } = await import('./cdp-drive.mjs')
    const cdp = await connect({ port: cdpPort })
    try {
      const probe = await cdp.evaluate('(' + surfaceCount.toString() + ')()').catch(() => null)
      return probe !== null && probe !== undefined && typeof probe.value === 'number' ? probe.value : -1
    } finally {
      try { cdp.close() } catch (ignored) { /* already closed */ }
    }
  }
  let now = await anchors()
  if (now > 0) return { door: 'already-open', anchors: now }
  // An empty rail has no guide; the collapse/expand pair re-seeds it, and the guide is the door below.
  await ensureGuidePresent(cdpPort)
  const viaAdd = await openBrowserPane(port, cdpPort, { waitMs: 4000 })
  now = await anchors()
  if (now > 0) return { door: 'add-control', anchors: now, steps: viaAdd.steps }
  // R381: the guide capsule is tried BEFORE the panel action here. Both open the pane, but the capsule leaves ONE tab
  // (the browser) while the panel action leaves two (LINK panel + browser), and a two-tab rail measured the panel 27-40 px
  // off its anchor in sidebar-follow. `parkAwayFromBrowserPane` still wants the two-chip world and calls the panel action
  // itself; this helper only has to leave the pane OPEN.
  const viaGuide = await openBrowserFromGuide(cdpPort)
  now = await anchors()
  if (now > 0) return { door: 'guide-capsule', anchors: now, steps: viaGuide }
  const viaPanel = await openBrowserThroughPanelAction(cdpPort)
  now = await anchors()
  return { door: now > 0 ? 'panel-action' : 'none', anchors: now, steps: viaPanel }
}

/**
 * Put the rail in the GUIDE-ONLY world: every chip closed, so the pane is empty and the shipped guide stands as its
 * sole tab.
 *
 * R377: this is the one entry the panel gates' own restore can RETURN to. Those gates reach our panel through the
 * guide capsule, and picking a capsule takes the guide chip with it - so a gate that entered on a three-chip rail
 * (guide + two others) can close its own tab and never put the guide back, which is exactly the restore reading that
 * has been red since R370. From guide-only, the gate's tab is the LAST tab: closing it empties the pane and the guide
 * re-seeds itself, so the exit world and the entry world are the same one by construction.
 * @param port - the shell port (kept so every world helper takes the same arguments).
 * @param cdpPort - the CDP port of the shell own page.
 * @returns the chips it closed and the chips it left.
 */
export const railGuideOnly = async (port, cdpPort = 9222) => {
  // R377: a collapsed rail shows no chips, so "close everything" would report success over a rail it never saw.
  await ensureRailExpanded(cdpPort)
  const { connect } = await import('./cdp-drive.mjs')
  const cdp = await connect({ port: cdpPort })
  try {
    const before = await cdp.evaluate('(' + railChipsExpression.toString() + ')()').catch(() => null)
    const closed = await cdp.evaluate('(' + closeEveryRailTab.toString() + ')()').catch(() => null)
    const deadline = Date.now() + 4000
    let chips = null
    while (Date.now() < deadline) {
      const probe = await cdp.evaluate('(' + railChipsExpression.toString() + ')()').catch(() => null)
      chips = probe === null || probe === undefined ? null : probe.value
      if (chips !== null && chips !== '[]') break
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    // R377: an emptied pane does NOT re-seed the guide on its own; the shipped collapse/expand pair does.
    let reseeded = null
    if (chips === null || chips === '[]') reseeded = await ensureGuidePresent(cdpPort)
    if (reseeded !== null) {
      const probe = await cdp.evaluate('(' + railChipsExpression.toString() + ')()').catch(() => null)
      chips = probe === null || probe === undefined ? null : probe.value
    }
    return { closed: closed === null ? null : closed.value, before: before === null ? null : before.value, chips, reseeded }
  } finally {
    try { cdp.close() } catch (ignored) { /* already closed */ }
  }
}