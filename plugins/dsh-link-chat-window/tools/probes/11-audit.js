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
  const found = { bindings: [], nodeStores: new Map(), components: new Map(), providers: [] }
  let count = 0
  while (stack.length > 0 && count < 400000) {
    const fiber = stack.pop()
    if (fiber === null || fiber === undefined || seen.has(fiber)) continue
    seen.add(fiber)
    count++
    const name = typeName(fiber)
    const props = fiber.memoizedProps
    if (props !== null && typeof props === 'object') {
      if (/^(ChatView|ChatFlow|ConversationRoot|ConversationSession|SessionProvider|SessionEntry|StrictSessionEntry|SessionView|ChatFlowList|ChatScroll)/.test(name)) {
        const record = found.components.get(name) ?? { count: 0, propKeys: Object.keys(props).slice(0, 45) }
        record.count++
        found.components.set(name, record)
      }
      for (const [key, value] of Object.entries(props)) {
        if (value === null || typeof value !== 'object') continue
        // real SessionBinding: session object + eventSource observable
        if (value.sessionId !== undefined && value.eventSource !== undefined && value.session !== undefined) {
          if (found.bindings.length < 3) {
            const win = (() => { try { const s = value.eventSource.getSnapshot(); return { entries: s.entries.length, hasMore: s.hasMore, revision: s.revision, kind: s.change?.kind } } catch (e) { return 'ERR ' + String(e) } })()
            found.bindings.push({ where: name + '.' + key, sessionId: value.sessionId, window: win })
          }
        }
        const own = Object.keys(value)
        if (own.includes('byKey') && own.includes('turnProcesses') && !found.nodeStores.has(name)) {
          const byKey = value.byKey
          const size = byKey instanceof Map ? byKey.size : (byKey !== null && typeof byKey === 'object' ? Object.keys(byKey).length : null)
          found.nodeStores.set(name, { size, sourcesKeys: value.sources instanceof Map ? value.sources.size : (value.sources !== null && typeof value.sources === 'object' ? Object.keys(value.sources).length : null) })
        }
        if ('value' in props && 'children' in props && value !== null && typeof value === 'object' && value.getSnapshot === undefined) {
          const keys = Object.keys(value)
          if (keys.length > 0 && found.providers.length < 12) found.providers.push(keys.slice(0, 24))
        }
      }
    }
    if (fiber.child !== null) stack.push(fiber.child)
    if (fiber.sibling !== null) stack.push(fiber.sibling)
  }
  // DOM measurements inside the conversation scroll container: find the element with the largest scrollHeight that contains chat seats.
  const chatSeat = document.querySelector('[data-chat-node]') ?? document.querySelector('[class*="ChatNodeSeat"]')
  let scroller = null
  if (chatSeat !== null) {
    let el = chatSeat
    while (el !== null) {
      if (el.scrollHeight > el.clientHeight + 10 && el.clientHeight > 100) { scroller = el; break }
      el = el.parentElement
    }
  }
  let chatElements = 0
  if (scroller !== null) chatElements = scroller.querySelectorAll('*').length
  const rowLike = document.querySelectorAll('[data-chat-node], [class*="row"]').length
  return {
    fibers: count,
    components: [...found.components.entries()],
    bindings: found.bindings,
    nodeStores: [...found.nodeStores.entries()],
    providers: found.providers,
    dom: {
      total: document.querySelectorAll('*').length,
      textNodesLen: (document.body.innerText ?? '').length,
      chatSeatFound: chatSeat !== null,
      scroller: scroller === null ? null : { tag: scroller.tagName, cls: [...scroller.classList].join(' ').slice(0, 80), clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight, children: scroller.childElementCount, elements: chatElements },
      rowLike,
    },
    heap: performance.memory === undefined ? null : { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize },
  }
})()
