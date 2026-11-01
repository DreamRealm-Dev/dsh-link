(async () => {
  const rootEl = document.querySelector('#root') ?? document.body.firstElementChild
  const containerKey = Object.keys(rootEl).find(k => k.startsWith('__reactContainer'))
  const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber'))
  const start = containerKey !== undefined ? rootEl[containerKey] : rootEl[fiberKey]
  const typeName = (fiber) => {
    const type = fiber.type
    if (type === null || type === undefined) return '(null)'
    if (typeof type === 'string') return type
    if (typeof type === 'function') return type.displayName ?? type.name ?? '(anonymous)'
    if (typeof type === 'object') return type.displayName ?? type.render?.displayName ?? type.render?.name ?? '(object)'
    return typeof type
  }
  const stack = [start]
  const seen = new Set()
  let sessionBinding = null
  let chatFlow = null
  let chatView = null
  let chatNodeStore = null
  let entryElt = null
  let count = 0
  while (stack.length > 0 && count < 400000) {
    const fiber = stack.pop()
    if (fiber === null || fiber === undefined || seen.has(fiber)) continue
    seen.add(fiber)
    count++
    const name = typeName(fiber)
    const props = fiber.memoizedProps
    if (props !== null && typeof props === 'object') {
      if (sessionBinding === null && name === 'SessionEntry' && props.binding !== null && typeof props.binding === 'object' && typeof props.binding.eventSource?.getSnapshot === 'function') {
        sessionBinding = props.binding
      }
      if (chatFlow === null && name === 'ChatFlow') chatFlow = props
      if (chatView === null && name === 'ChatView') chatView = props
      if (chatNodeStore === null && name === 'ChatNodeSeat' && props.nodeStore !== null) chatNodeStore = props.nodeStore
      if (entryElt === null && typeof name === 'string' && /Flow|Scroll|Viewport/.test(name) && props.entries !== undefined) entryElt = { name }
    }
    if (fiber.child !== null) stack.push(fiber.child)
    if (fiber.sibling !== null) stack.push(fiber.sibling)
  }
  const out = { fibers: count }
  if (sessionBinding !== null) {
    const window = sessionBinding.eventSource.getSnapshot()
    const session = sessionBinding.session
    out.session = {
      sessionId: sessionBinding.sessionId,
      window: { entries: window.entries.length, hasMore: window.hasMore, revision: window.revision, changeKind: window.change.kind },
      sessionSnapshot: (() => { try { return session.getSnapshot() } catch (error) { return { error: String(error) } } })(),
      sessionOwnKeys: Object.keys(session).slice(0, 30),
      hasLoadOlder: typeof session.loadOlder === 'function',
      hasLoadThrough: typeof session.loadThrough === 'function',
      windowFirstLast: window.entries.length === 0 ? null : { firstSeq: window.entries[0].event.seq, lastSeq: window.entries[window.entries.length - 1].event.seq, types: [...new Set(window.entries.map(e => e.event.type))] },
    }
  }
  if (chatFlow !== null) {
    const entries = chatFlow.entries
    out.chatFlowEntries = entries === null || entries === undefined ? null : {
      length: entries.length,
      sample: entries.slice(0, 6).map(e => (e !== null && typeof e === 'object' ? Object.keys(e) : typeof e)),
      last: entries.length === 0 ? null : (entries[entries.length - 1] !== null && typeof entries[entries.length - 1] === 'object' ? Object.keys(entries[entries.length - 1]) : entries[entries.length - 1]),
    }
  }
  if (chatView !== null) {
    out.chatView = {
      propKeys: Object.keys(chatView).slice(0, 40),
      loadOlder: typeof chatView.loadOlder,
      loadThrough: typeof chatView.loadThrough,
      chatScroll: chatView.chatScroll !== null && typeof chatView.chatScroll === 'object' ? (() => { try { const s = chatView.chatScroll.getSnapshot(); return s === null || typeof s !== 'object' ? s : Object.keys(s) } catch (e) { return 'ERR ' + String(e) } })() : typeof chatView.chatScroll,
    }
  }
  if (chatNodeStore !== null) {
    const byKey = chatNodeStore.byKey
    const size = byKey instanceof Map ? byKey.size : (byKey !== null && typeof byKey === 'object' ? Object.keys(byKey).length : null)
    out.chatNodeStore = { byKeySize: size, ownKeys: Object.keys(chatNodeStore) }
  }
  out.dom = {
    totalElements: document.querySelectorAll('*').length,
    chatSeatElements: document.querySelectorAll('[class*="ChatNodeSeat"]').length,
    rowLike: document.querySelectorAll('[class*="row"]').length,
  }
  return out
})()
