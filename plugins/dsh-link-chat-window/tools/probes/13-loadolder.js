(async () => {
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
  const snapshot = () => {
    const scroller = [...document.querySelectorAll('*')].find(el => el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 400)
    return {
      dom: document.querySelectorAll('*').length,
      chatDom: scroller === undefined ? null : scroller.querySelectorAll('*').length,
      scrollHeight: scroller === undefined ? null : scroller.scrollHeight,
      heap: performance.memory === undefined ? null : performance.memory.usedJSHeapSize,
    }
  }
  const findFiberProps = (name, key) => {
    const stack = [start]
    const seen = new Set()
    let count = 0
    while (stack.length > 0 && count < 400000) {
      const fiber = stack.pop()
      if (fiber === null || fiber === undefined || seen.has(fiber)) continue
      seen.add(fiber)
      count++
      if (typeName(fiber) === name && fiber.memoizedProps !== null && typeof fiber.memoizedProps === 'object') return fiber.memoizedProps
      if (fiber.child !== null) stack.push(fiber.child)
      if (fiber.sibling !== null) stack.push(fiber.sibling)
    }
    return null
  }
  const chatFlow = findFiberProps('ChatFlow')
  const chatView = findFiberProps('ChatView')
  const before = Object.assign(snapshot(), {
    flowEntries: chatFlow === null || chatFlow.entries === undefined ? null : chatFlow.entries.length,
    firstEntry: chatFlow === null || chatFlow.entries === undefined || chatFlow.entries.length === 0 ? null : chatFlow.entries[0].key,
  })
  const loadOlder = chatView === null ? null : chatView.loadOlder
  if (typeof loadOlder !== 'function') return { error: 'loadOlder not reachable', before }
  const t0 = performance.now()
  let loadResult = 'ok'
  try { await loadOlder() } catch (error) { loadResult = 'ERR ' + String(error) }
  const loadMs = Math.round(performance.now() - t0)
  // wait for network page + react commit
  await new Promise(resolve => setTimeout(resolve, 5000))
  const chatFlow2 = findFiberProps('ChatFlow')
  let flowEntries2 = null
  try {
    // re-walk for the fresh fiber props after commit
    flowEntries2 = chatFlow2 === null || chatFlow2.entries === undefined ? null : chatFlow2.entries.length
  } catch (error) { flowEntries2 = 'ERR ' + String(error) }
  const after = Object.assign(snapshot(), { flowEntries: flowEntries2, loadMs, loadResult })
  return { before, after, delta: {
    dom: after.dom - before.dom,
    chatDom: after.chatDom === null || before.chatDom === null ? null : after.chatDom - before.chatDom,
    scrollHeight: after.scrollHeight === null || before.scrollHeight === null ? null : after.scrollHeight - before.scrollHeight,
    heap: after.heap === null || before.heap === null ? null : after.heap - before.heap,
    flowEntries: typeof after.flowEntries === 'number' && typeof before.flowEntries === 'number' ? after.flowEntries - before.flowEntries : null,
  } }
})()
