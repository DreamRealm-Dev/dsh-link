#!/usr/bin/env node
/**
 * Warm the live world in ONE command, and say what it found.
 *
 * Measured cost of NOT having this (R312): getting the teams pane back after a client restart took a long stretch of
 * manual CDP archaeology - the rail comes back collapsed, the 智能体团队 tab is gone from it, and the sidebar browser
 * panel the foreign-app gate drives is closed. Every live gate then reported "NOT MEASURED" instead of measuring, and
 * nothing in the tree said which of the four preconditions was missing.
 *
 * The four preconditions this establishes, in this order (each one is read back, not assumed):
 *
 *   0 a REAL VIEWPORT     innerWidth/innerHeight are a window, not the stuck 158x26 the WebView2 child can keep
 *                         when the host window was resized behind its back (R313: rail 0 px, pane 0 chars, three
 *                         live gates declining to measure). This one is checked FIRST because everything below
 *                         depends on it and nothing else can tell you it happened;
 *   1 a SESSION VIEW      the client is in a conversation, which is the only view that has the right rail at all;
 *   2 the RAIL is OPEN    [data-rightbar-col] has a non-zero width;
 *   3 the TEAMS TAB       a tab titled 智能体团队 is selected, and its body is non-0x0 with the pane's three words;
 *   4 the BROWSER PANEL   only with --with-panel: POST /__shell/panel says exists && mounted. This one is OPT-IN and
 *     the default CLOSES any panel, because the two families of live gates need opposite worlds and the second family
 *     is the larger one: panel-render / panel-contribution-render / panel-action-render walk the rail and open their own
 *     tab, and a browser panel already mounted makes them refuse (measured in the R312 full pass, where a warmed world
 *     with the panel up turned those three red). foreign-app-agent-live is the one gate that needs it mounted.
 *
 * Usage: node scripts/warm-world.mjs [--port 31761] [--cdp-port 9222] [--json]
 * Exit: 0 all four hold | 3 one of them could not be established (named, with what was on screen)
 */
import { connect } from './cdp-drive.mjs'
import { claimLease, releaseLease, openOwnPanel, panelPost } from './panel-lease.mjs'

const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const PORT = Number(option('--port', '31761'))
const CDP_PORT = Number(option('--cdp-port', '9222'))
const JSON_OUT = argv.includes('--json')
const TAB_TITLE = '智能体团队'
const PANE_WORDS = ['任务板', '成员', '交流']
const HOLDER = 'warm-world'
const WITH_PANEL = argv.includes('--with-panel')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const steps = []
const note = (step, ok, detail) => { steps.push({ step, ok: ok === true, detail: String(detail) }) }

/** One expression that reports everything this tool decides on, so no step reads a stale snapshot. */
function probe(wantTab, words) {
  const rail = document.querySelector('[data-rightbar-col]')
  const box = rail === null ? null : rail.getBoundingClientRect()
  const tabs = rail === null ? [] : Array.from(rail.querySelectorAll('[role=tab][data-dockkit-tab]')).map((el) => {
    const title = el.querySelector('[data-dockkit-tab-title]')
    return { title: ((title && title.textContent) || '').trim().slice(0, 24), selected: el.getAttribute('aria-selected') === 'true', id: el.getAttribute('data-dockkit-tab') }
  })
  const selected = tabs.filter((tab) => tab.selected && tab.title.includes(String(wantTab)))[0] || null
  const content = selected === null ? null : document.querySelector('[data-dockkit-content="' + selected.id + '"]')
  const contentBox = content === null ? null : content.getBoundingClientRect()
  const text = content === null ? '' : (content.innerText || '')
  return JSON.stringify({
    vw: window.innerWidth,
    vh: window.innerHeight,
    session: document.body.innerText.length > 400 && document.querySelector('[class*=newSession],[class*=composer],textarea[placeholder]') !== null,
    rail: box === null ? null : [Math.round(box.width), Math.round(box.height)],
    tabs,
    selected: selected === null ? null : selected.title,
    paneBox: contentBox === null ? null : [Math.round(contentBox.width), Math.round(contentBox.height)],
    paneWords: words.filter((word) => text.includes(word)),
    opensRail: Array.from(document.querySelectorAll('button,[role=button]')).some((el) => ((el.getAttribute('aria-label') || el.textContent || '').trim()) === '打开右侧边栏'),
    newSession: document.querySelector('[class*=newSession]') !== null,
    guideEntry: document.querySelector('[data-sidebar-right-guide-entry="link-teams"]') !== null,
    folds: content === null ? 0 : content.querySelectorAll('details:not([open])').length,
  })
}

const clickExpr = (selectorOrText) => '(' + (function (want) {
  const bySelector = document.querySelector(want)
  if (bySelector !== null) { bySelector.click(); return 'clicked-selector:' + want }
  const all = Array.from(document.querySelectorAll('button,[role=button],div'))
  const hit = all.filter((el) => ((el.getAttribute('aria-label') || el.textContent || '').trim()) === want)[0]
  if (hit === undefined) return 'not-found:' + want
  hit.click()
  return 'clicked-text:' + want
}).toString() + ')(' + JSON.stringify(selectorOrText) + ')'

const read = async (cdp) => {
  const seen = await cdp.json('(' + probe.toString() + ')(' + JSON.stringify(TAB_TITLE) + ',' + JSON.stringify(PANE_WORDS) + ')')
  return seen.ok === true ? seen.value : null
}

const main = async () => {
  const cdp = await connect({ port: CDP_PORT, deadlineMs: 15000 }).catch(() => null)
  if (cdp === null) {
    note('cdp', false, 'no CDP on ' + String(CDP_PORT) + ': the world cannot be warmed from here (start the shell with DSH_LINK_WEBVIEW2_ARGS=--remote-debugging-port=' + String(CDP_PORT) + ')')
    return 3
  }
  try {
    // 1. a session view. The rail only exists inside a conversation, so this comes first.
    let state = await read(cdp)
    if (state === null) { note('cdp', false, 'the page did not answer Runtime.evaluate'); return 3 }
    if (state.session !== true) {
      await cdp.json(clickExpr('[class*=newSession]'))
      await wait(2500)
      state = await read(cdp)
    }
    // 0. the window has a real viewport. R313 measured the failure this catches: the shell window was 1440x900 while
    // the WebView2 child stayed at 158x26, so the rail laid out at 0 px, the pane read 0 characters, and three live
    // gates declined to measure. Resizing the host window does NOT propagate; a client restart does.
    const viewportOk = typeof state.vw === 'number' && typeof state.vh === 'number' && state.vw >= 600 && state.vh >= 400
    note('0-viewport', viewportOk, 'innerWidth ' + String(state.vw) + ' x innerHeight ' + String(state.vh) + (viewportOk ? '' : ' - the webview is stuck smaller than any window: restart the client (SetWindowPos on the host window does not reach it)'))
    if (viewportOk === false) return 3
    note('1-session-view', state.session === true, state.session === true ? 'the client is in a conversation view' : 'no conversation view: nothing on the page opens one (body ' + String(state.tabs.length) + ' rail tab(s))')

    // 2. the rail open.
    if (state.rail !== null && state.rail[0] === 0 && state.opensRail) {
      await cdp.json(clickExpr('打开右侧边栏'))
      await wait(2000)
      state = await read(cdp)
    }
    const railOpen = state.rail !== null && state.rail[0] > 200
    note('2-rail-open', railOpen, state.rail === null ? 'there is no [data-rightbar-col] at all' : 'rail width ' + String(state.rail[0]) + 'px' + (state.opensRail ? '' : ' (no 打开右侧边栏 control on screen)'))

    // 3. the teams tab, selected, with its body rendered.
    if (railOpen && state.selected !== TAB_TITLE) {
      // An EXISTING tab with that title is the cheapest way in (the guide entry only exists while the add-tab menu is
      // open, and it is not in every client build). Measured order: existing tab -> guide entry -> add-tab menu.
      const clickTab = '(' + (function (want) {
        const tabs = Array.from(document.querySelectorAll('[role=tab][data-dockkit-tab]'))
        const hit = tabs.filter((el) => { const title = el.querySelector('[data-dockkit-tab-title]'); return title !== null && String(title.textContent).includes(String(want)) })[0]
        if (hit === undefined) return 'no-tab'
        hit.click()
        return 'clicked-tab'
      }).toString() + ')(' + JSON.stringify(TAB_TITLE) + ')'
      const byTab = await cdp.json(clickTab)
      if (byTab.ok !== true || byTab.value === 'no-tab') {
        await cdp.json(clickExpr('[class*=addTab]'))
        await wait(800)
        await cdp.json(clickExpr('[data-sidebar-right-guide-entry="link-teams"]'))
      }
      await wait(2500)
      state = await read(cdp)
    }
    const paneReady = state.selected === TAB_TITLE && state.paneBox !== null && state.paneBox[0] > 0 && state.paneWords.length === PANE_WORDS.length
    note('3-teams-tab', paneReady, state.selected === null ? 'no tab titled ' + TAB_TITLE + ' is selected (tabs: ' + JSON.stringify(state.tabs.map((tab) => tab.title)) + ')' : 'selected ' + JSON.stringify(state.selected) + ', body ' + JSON.stringify(state.paneBox) + ', words ' + JSON.stringify(state.paneWords))

    // 4. the sidebar browser panel: mounted only when asked, closed otherwise (see the header).
    const before = await panelPost(PORT, { op: 'state' })
    let panel = before
    if (WITH_PANEL) {
      if (before === null || before.exists !== true || before.mounted !== true) {
        await claimLease(PORT, HOLDER, 120000)
        const opened = await openOwnPanel(PORT, { x: 900, y: 120, w: 640, h: 600 })
        await releaseLease(PORT, HOLDER)
        panel = opened === null ? await panelPost(PORT, { op: 'state' }) : opened
      }
    } else if (before !== null && before.exists === true) {
      await claimLease(PORT, HOLDER, 120000)
      await panelPost(PORT, { op: 'close', holder: HOLDER })
      await releaseLease(PORT, HOLDER)
      panel = await panelPost(PORT, { op: 'state' })
    }
    const panelOk = WITH_PANEL
      ? panel !== null && panel.exists === true && panel.mounted === true
      : panel === null || panel.exists !== true
    note(WITH_PANEL ? '4-browser-panel(mounted)' : '4-browser-panel(closed)', panelOk, panel === null
      ? 'the shell did not answer op=state'
      : 'exists=' + String(panel.exists) + ' mounted=' + String(panel.mounted) + ' label=' + String(panel.label))

    const all = steps.every((step) => step.ok === true)
    if (JSON_OUT) console.log(JSON.stringify({ ok: all, steps }))
    else {
      for (const step of steps) console.log((step.ok ? 'ok    ' : 'FAIL  ') + step.step + '  ' + step.detail)
      console.log('')
      const panelWord = WITH_PANEL ? 'browser panel mounted' : 'no browser panel (the panel-family gates need it closed; pass --with-panel for foreign-app-agent-live)'
      console.log(all ? 'the world is warm: session view, rail open, teams tab rendered, ' + panelWord : 'the world is NOT warm: the steps above say which precondition is missing')
    }
    return all ? 0 : 3
  } finally {
    // Deliberately NOT closing the CDP socket: measured twice in this environment, closing it and then letting node
    // drain its event loop dies with "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c"
    // and an exit code of -1073740791, i.e. a tool that warmed the world correctly would report failure. The process
    // is exiting in the next statement anyway; the OS reclaims the socket.
  }
}

const verdict = await main()
// Measured (R312): calling process.exit while a keep-alive fetch/WebSocket teardown is in flight leaves node with
// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" and an exit code of -1073740791, so a run that warmed the
// world correctly would report failure. Give the loop one turn to finish its closes, then exit on the real verdict.
await new Promise((resolve) => setTimeout(resolve, 400))
process.exit(verdict)
