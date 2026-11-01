(async () => {
  const find = () => {
    const rootEl = document.querySelector('#root') ?? document.body.firstElementChild
    const containerKey = Object.keys(rootEl).find(k => k.startsWith('__reactContainer'))
    const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber'))
    const start = containerKey !== undefined ? rootEl[containerKey] : rootEl[fiberKey]
    const typeName = (fiber) => {
      const type = fiber.type
      if (type === null || type === undefined) return ''
      if (typeof type === 'string') return type
      if (typeof type === 'function') return type.displayName ?? type.name ?? ''
      return ''
    }
    const stack = [start]
    const seen = new Set()
    let count = 0
    let chatView = null
    let chatFlow = null
    let nodeStore = null
    let sessions = null
    let scroller = null
    while (stack.length > 0 && count < 200000) {
      const fiber = stack.pop()
      if (fiber === null || fiber === undefined || seen.has(fiber)) continue
      seen.add(fiber)
      count += 1
      const name = typeName(fiber)
      const props = fiber.memoizedProps
      if (props !== null && typeof props === 'object') {
        if (name === 'ChatView') chatView = props
        else if (name === 'ChatFlow') chatFlow = props
        else if (name === 'ChatNodeSeat' && nodeStore === null) nodeStore = props.nodeStore
        else if (sessions === null && 'value' in props && 'children' in props) {
          const value = props.value
          if (value !== null && typeof value === 'object' && value.ctx !== undefined && typeof value.ctx.get === 'function') {
            try {
              const service = value.ctx.get('sessions')
              if (service !== null && service !== undefined && typeof service.binding === 'function') sessions = service
            } catch (error) { /* not this context */ }
          }
        }
      }
      if (fiber.child !== null) stack.push(fiber.child)
      if (fiber.sibling !== null) stack.push(fiber.sibling)
    }
    for (const element of document.querySelectorAll('*')) {
      const elementHeight = element.clientHeight
      if (elementHeight > 300 && element.scrollHeight > elementHeight + 100) {
        if (scroller === null || element.querySelectorAll('*').length > scroller.querySelectorAll('*').length) scroller = element
      }
    }
    return { fibers: count, chatView, chatFlow, nodeStore, sessions, scroller }
  }
  const current = () => {
    const found = find()
    const sessionId = found.chatView === null ? null : found.chatView.sessionId
    const binding = found.sessions === null || sessionId === null || sessionId === undefined ? undefined : found.sessions.binding(sessionId)
    return { found, sessionId, binding }
  }
  const windowInfo = () => {
    const { binding, sessionId } = current()
    if (binding === undefined) return { sessionId, binding: false }
    const window = binding.eventSource.getSnapshot()
    const sessionSnapshot = binding.session.getSnapshot()
    const entries = window.entries
    let contiguous = true
    for (let index = 1; index < entries.length; index += 1) {
      if (entries[index].event.seq !== entries[index - 1].event.seq + 1) { contiguous = false; break }
    }
    const boundary = { firstSeq: entries[0]?.event.seq, lastSeq: entries[entries.length - 1]?.event.seq }
    return {
      sessionId,
      binding: true,
      entries: entries.length,
      hasMore: window.hasMore,
      sessionHasMore: sessionSnapshot.hasMore,
      sessionLoadingOlder: sessionSnapshot.loadingOlder,
      openState: sessionSnapshot.openState,
      revision: window.revision,
      baseSeq: binding.session.baseSeq,
      windowLimit: binding.session.windowLimit ?? null,
      contiguous,
      firstSeq: boundary.firstSeq,
      lastSeq: boundary.lastSeq,
      minSeq: Math.min(...entries.map(entry => entry.event.seq)),
      trimPrimitive: typeof binding.eventSource.trimToTail,
      maintain: typeof binding.session.maintainEventWindow,
    }
  }
  const dom = () => {
    const { found } = current()
    const scroller = found.scroller
    return {
      total: document.querySelectorAll('*').length,
      chatElements: scroller === null ? 0 : scroller.querySelectorAll('*').length,
      scrollHeight: scroller === null ? 0 : scroller.scrollHeight,
      scrollTop: scroller === null ? 0 : scroller.scrollTop,
      clientHeight: scroller === null ? 0 : scroller.clientHeight,
      distanceFromBottom: scroller === null ? 0 : Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight),
      followingTail: document.querySelector('[data-chat-following-tail]') !== null,
      olderButton: [...document.querySelectorAll('button')].some(button => (button.textContent ?? '').includes('加载更早')),
      heap: performance.memory === undefined ? null : performance.memory.usedJSHeapSize,
    }
  }
  const nodes = () => {
    const { found } = current()
    let flowEntries = null
    if (found.chatFlow !== null && found.chatFlow.entries !== undefined) flowEntries = found.chatFlow.entries.length
    let byKey = null
    if (found.nodeStore !== null && found.nodeStore.byKey !== undefined) {
      byKey = found.nodeStore.byKey instanceof Map ? found.nodeStore.byKey.size : Object.keys(found.nodeStore.byKey).length
    }
    return { flowEntries, byKey }
  }
  const scrollTo = (position) => {
    const { found } = current()
    const scroller = found.scroller
    if (scroller === null) return null
    const target = position === 'bottom' ? scroller.scrollHeight : position === 'top' ? 0 : Number(position)
    scroller.scrollTop = target
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    return { scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight }
  }
  const anchorAtViewport = (offset = 8) => {
    const { found } = current()
    const scroller = found.scroller
    if (scroller === null) return null
    const rect = scroller.getBoundingClientRect()
    const x = rect.left + Math.min(120, rect.width / 3)
    const y = rect.top + offset
    const element = document.elementFromPoint(x, y)
    if (element === null) return null
    let row = element
    while (row !== null && row !== scroller && row.parentElement !== null) {
      if (row.parentElement === scroller) break
      row = row.parentElement
    }
    return { text: (row.textContent ?? '').replace(/\s+/g, ' ').slice(0, 120), top: Math.round(row.getBoundingClientRect().top), height: Math.round(row.getBoundingClientRect().height) }
  }
  const folds = () => {
    const { found } = current()
    const scroller = found.scroller
    if (scroller === null) return []
    return [...scroller.querySelectorAll('button[aria-expanded]')].slice(0, 80).map((button, index) => ({
      index,
      expanded: button.getAttribute('aria-expanded'),
      text: (button.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    }))
  }
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  const settle = async (stableMs = 600, timeoutMs = 20000) => {
    const begun = Date.now()
    let previous = ''
    let stableSince = Date.now()
    while (Date.now() - begun < timeoutMs) {
      const marker = JSON.stringify({ info: windowInfo(), nodes: nodes(), dom: dom() })
      if (marker === previous) {
        if (Date.now() - stableSince >= stableMs) return true
      } else {
        previous = marker
        stableSince = Date.now()
      }
      await sleep(200)
    }
    return false
  }
  const openSession = async (sessionId, timeoutMs = 30000) => {
    const bridge = globalThis.__dshSessionNav
    if (bridge === undefined) return { ok: false, error: 'nav bridge missing' }
    const accepted = bridge.openSession(sessionId)
    const begun = Date.now()
    while (Date.now() - begun < timeoutMs) {
      await sleep(200)
      let observed = { sessionId: null, binding: undefined }
      try { observed = current() } catch (error) { /* mid-render */ }
      const { sessionId: currentId, binding } = observed
      if (currentId === sessionId && binding !== undefined && binding.session.getSnapshot().openState === 'open' && binding.eventSource.getSnapshot().entries.length > 0) {
        await settle()
        return { ok: true, accepted }
      }
    }
    return { ok: false, accepted, last: windowInfo() }
  }
  const setPolicy = (maxEvents = 500, slackEvents = 125, trimOpeningPage = true) => {
    globalThis.__DSH_EVENT_WINDOW_LIMIT__ = { maxEvents, slackEvents, trimOpeningPage, setBy: 'r493-live-gate', version: 1 }
    return globalThis.__DSH_EVENT_WINDOW_LIMIT__
  }
  const clearPolicy = () => { delete globalThis.__DSH_EVENT_WINDOW_LIMIT__; return globalThis.__DSH_EVENT_WINDOW_LIMIT__ ?? null }
  const syntheticAppend = (count = 1) => {
    const { binding } = current()
    if (binding === undefined) return { error: 'no binding' }
    const before = windowInfo()
    let last = before.lastSeq ?? 0
    for (let index = 0; index < count; index += 1) {
      last += 1
      binding.eventSource.append({ type: 'event', event: { seq: last, type: 'system/message', time: Date.now(), data: {} } })
    }
    const applied = binding.session.maintainEventWindow()
    const after = windowInfo()
    return { before: { entries: before.entries, baseSeq: before.baseSeq, lastSeq: before.lastSeq }, after: { entries: after.entries, baseSeq: after.baseSeq, lastSeq: after.lastSeq, hasMore: after.hasMore, sessionHasMore: after.sessionHasMore }, maintainedTrim: applied === undefined ? 'void' : applied, appended: count }
  }
  const loadOlder = async () => {
    const { binding } = current()
    if (binding === undefined) return { error: 'no binding' }
    const before = windowInfo()
    const began = performance.now()
    let error = null
    try { await binding.session.loadOlder() } catch (caught) { error = String(caught) }
    const ms = performance.now() - began
    await settle()
    const after = windowInfo()
    return { ms: Math.round(ms), error, before: { entries: before.entries, baseSeq: before.baseSeq }, after: { entries: after.entries, baseSeq: after.baseSeq, firstSeq: after.firstSeq, lastSeq: after.lastSeq, hasMore: after.hasMore, contiguous: after.contiguous } }
  }
  const loadThrough = async (seq) => {
    const { binding } = current()
    if (binding === undefined) return { error: 'no binding' }
    const before = windowInfo()
    const began = performance.now()
    let error = null
    try { await binding.session.loadThrough(seq) } catch (caught) { error = String(caught) }
    const ms = performance.now() - began
    await settle()
    const after = windowInfo()
    return { ms: Math.round(ms), error, seq, before: { entries: before.entries, baseSeq: before.baseSeq }, after: { entries: after.entries, baseSeq: after.baseSeq, firstSeq: after.firstSeq, lastSeq: after.lastSeq, hasMore: after.hasMore, contiguous: after.contiguous } }
  }
  const measureInteraction = async (toggleIndex = 0) => {
    const button = [...document.querySelectorAll('button[aria-expanded="false"]')].filter(button => button.closest('[class*="scrollBody"], [class*="scroll"]') !== null)[toggleIndex] ?? null
    if (button === null) return { error: 'no fold toggle' }
    const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
    const twoFrames = async () => { await frame(); await frame() }
    const domBefore = document.querySelectorAll('*').length
    await twoFrames()
    const began = performance.now()
    button.click()
    await twoFrames()
    const openMs = performance.now() - began
    const domOpen = document.querySelectorAll('*').length
    button.click()
    await twoFrames()
    const domClosed = document.querySelectorAll('*').length
    return { domBefore, domOpen, domClosed, openMs: Math.round(openMs * 10) / 10 }
  }
  const clickFold = (index = 0) => {
    const { found } = current()
    const scroller = found.scroller
    if (scroller === null) return { error: 'no scroller' }
    const buttons = [...scroller.querySelectorAll('button[aria-expanded]')].filter(button => button.getAttribute('aria-expanded') === 'false')
    const button = buttons[index] ?? null
    if (button === null) return { error: 'no collapsed fold toggle', count: buttons.length }
    const label = (button.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
    const foldKey = { label, before: button.getAttribute('aria-expanded') }
    const domBefore = document.querySelectorAll('*').length
    button.click()
    return { foldKey, domBefore }
  }
  const foldState = () => {
    const { found } = current()
    if (found.scroller === null) return []
    return [...found.scroller.querySelectorAll('button[aria-expanded]')].slice(0, 120).map(button => ({
      label: (button.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100),
      expanded: button.getAttribute('aria-expanded'),
    }))
  }
  const loadThroughRace = async (seq, waitMs = 200) => {
    const { binding } = current()
    if (binding === undefined) return { error: 'no binding' }
    const before = windowInfo()
    const promise = binding.session.loadThrough(seq)
    await sleep(waitMs)
    const mid = windowInfo()
    const midMaintain = binding.session.maintainEventWindow()
    const midAfter = windowInfo()
    let error = null
    try { await promise } catch (caught) { error = String(caught) }
    await settle()
    const after = windowInfo()
    return {
      error, seq, waitMs,
      before: { entries: before.entries, baseSeq: before.baseSeq },
      mid: { entries: mid.entries, baseSeq: mid.baseSeq, loadingOlder: mid.sessionLoadingOlder },
      midMaintain,
      midAfter: { entries: midAfter.entries, baseSeq: midAfter.baseSeq },
      after: { entries: after.entries, baseSeq: after.baseSeq, firstSeq: after.firstSeq, lastSeq: after.lastSeq, hasMore: after.hasMore, contiguous: after.contiguous },
      trimDeferredDuringJump: mid.entries === midAfter.entries && mid.entries > 625,
    }
  }
  const ensureMounted = async (timeoutMs = 15000) => {
    const begun = Date.now()
    while (Date.now() - begun < timeoutMs) {
      if (find().sessions !== null) return true
      await sleep(100)
    }
    return false
  }
  const runEnabledGate = async (sessionId) => {
    await ensureMounted()
    await sleep(200)
    const sessions = current().found.sessions
    const targetAlreadyRetained = sessions !== null && sessions.binding(sessionId) !== undefined
    const policy = setPolicy(500, 125, true)
    const open = await openSession(sessionId)
    const openInfo = windowInfo()
    const policyApplied = openInfo.windowLimit !== null
    const openDom = dom()
    const openNodes = nodes()
    // P1 fold: one collapsed process row is opened, then a live-tail trim happens; retained rows must keep their fold state.
    const foldsBefore = foldState()
    const domBeforeFold = dom()
    const foldClick = clickFold(0)
    await sleep(200)
    const foldOpenState = foldState()
    const domOpen = dom()
    const trimAfterFold = syntheticAppend(130)
    await settle()
    const foldsAfter = foldState()
    const openLabels = new Map(foldOpenState.map(entry => [entry.label, entry.expanded]))
    const retainedFolds = foldsAfter.map(entry => ({ label: entry.label, after: entry.expanded, open: openLabels.get(entry.label) }))
    const foldRetained = retainedFolds.filter(entry => entry.open !== undefined)
    const foldScenario = {
      click: foldClick,
      domBefore: domBeforeFold,
      domOpen,
      trim: trimAfterFold,
      foldsAfterCount: foldsAfter.length,
      retainedCount: foldRetained.length,
      retainedPreserved: foldRetained.every(entry => entry.open === entry.after),
      sampleRetained: foldRetained.slice(-3),
      domAfterTrim: dom(),
      foldStateAfter: foldsAfter.slice(-3),
    }
    // P1 bottom follow: at the tail, a live append + trim must not move the viewport away from the newest content.
    scrollTo('bottom')
    await sleep(300)
    const bottomBefore = dom()
    const bottomAnchorBefore = anchorAtViewport(Math.max(8, bottomBefore.clientHeight - 40))
    const trimAtBottom = syntheticAppend(130)
    await settle()
    const bottomAfter = dom()
    const bottomAnchorAfter = anchorAtViewport(Math.max(8, bottomAfter.clientHeight - 40))
    const bottomScenario = {
      before: { distanceFromBottom: bottomBefore.distanceFromBottom, followingTail: bottomBefore.followingTail, scrollTop: bottomBefore.scrollTop },
      trim: trimAtBottom,
      after: { distanceFromBottom: bottomAfter.distanceFromBottom, followingTail: bottomAfter.followingTail, scrollTop: bottomAfter.scrollTop, entries: trimAtBottom.after.entries, baseSeq: trimAtBottom.after.baseSeq, hasMore: trimAtBottom.after.hasMore },
      anchor: { before: bottomAnchorBefore, after: bottomAnchorAfter, sameText: bottomAnchorBefore !== null && bottomAnchorAfter !== null && bottomAnchorBefore.text === bottomAnchorAfter.text },
    }
    // P1 old-page reading: an official loadOlder page is being read when a live append + trim arrives.
    const older = await loadOlder()
    const afterOlder = windowInfo()
    const olderDom = dom()
    scrollTo(Math.round(olderDom.scrollHeight * 0.35))
    await sleep(300)
    const readingBefore = { anchor: anchorAtViewport(72), dom: dom(), info: windowInfo() }
    const trimWhileReading = syntheticAppend(130)
    await settle()
    const readingAfter = { anchor: anchorAtViewport(72), dom: dom(), info: windowInfo() }
    const oldPageScenario = {
      loadOlder: { ms: older.ms, error: older.error, entries: older.after.entries, baseSeq: older.after.baseSeq, firstSeq: older.after.firstSeq, contiguous: older.after.contiguous, hasMore: older.after.hasMore },
      boundaryContiguous: afterOlder.contiguous,
      beforeReading: { scrollTop: readingBefore.dom.scrollTop, scrollHeight: readingBefore.dom.scrollHeight, anchor: readingBefore.anchor, entries: readingBefore.info.entries, baseSeq: readingBefore.info.baseSeq },
      trim: trimWhileReading,
      afterTrim: { scrollTop: readingAfter.dom.scrollTop, scrollHeight: readingAfter.dom.scrollHeight, anchor: readingAfter.anchor, entries: readingAfter.info.entries, baseSeq: readingAfter.info.baseSeq },
      anchorJumped: !(readingBefore.anchor !== null && readingAfter.anchor !== null && readingBefore.anchor.text === readingAfter.anchor.text),
      scrollHeightDelta: readingAfter.dom.scrollHeight - readingBefore.dom.scrollHeight,
      scrollTopDelta: readingAfter.dom.scrollTop - readingBefore.dom.scrollTop,
    }
    // P1 turn jump: loadThrough an old turn; the trim guard must stay quiet while the jump is in flight.
    const jump = await loadThrough(1500)
    const trimAfterJump = syntheticAppend(130)
    const race = await loadThroughRace(100, 250)
    await settle()
    const trimAfterRace = syntheticAppend(130)
    await settle()
    const turnJumpScenario = {
      loadThrough: { ms: jump.ms, error: jump.error, entries: jump.after.entries, baseSeq: jump.after.baseSeq, firstSeq: jump.after.firstSeq, lastSeq: jump.after.lastSeq, contiguous: jump.after.contiguous, hasMore: jump.after.hasMore },
      trimAfterJump,
      race,
      trimAfterRace,
      final: windowInfo(),
    }
    return { policy, targetAlreadyRetained, policyApplied, open, openInfo, openDom, openNodes, foldScenario, bottomScenario, oldPageScenario, turnJumpScenario }
  }
  const runDefaultOffGate = async (sessionId) => {
    await ensureMounted()
    await sleep(200)
    const policy = globalThis.__DSH_EVENT_WINDOW_LIMIT__ ?? null
    const open = await openSession(sessionId)
    const openInfo = windowInfo()
    const openDom = dom()
    const steps = []
    for (let index = 0; index < 6; index += 1) {
      const info = windowInfo()
      if (info.hasMore === false) break
      const older = await loadOlder()
      steps.push({ step: index + 1, ms: older.ms, error: older.error, entries: older.after.entries, baseSeq: older.after.baseSeq, hasMore: older.after.hasMore })
      if (older.error !== null) break
    }
    const finalInfo = windowInfo()
    const finalDom = dom()
    return { policy, open, openInfo, openDom, steps, finalInfo, finalDom, nodes: nodes() }
  }
  globalThis.__r493 = { runEnabledGate, runDefaultOffGate, ensureMounted, find, current, windowInfo, dom, nodes, scrollTo, anchorAtViewport, folds, foldState, clickFold, sleep, settle, openSession, setPolicy, clearPolicy, syntheticAppend, loadOlder, loadThrough, loadThroughRace, measureInteraction, version: 1 }
  return { installed: true, info: windowInfo(), dom: dom(), nodes: nodes() }
})()
