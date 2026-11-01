(async () => {
  const rootEl = document.querySelector('#root') ?? document.body.firstElementChild
  const containerKey = Object.keys(rootEl).find(k => k.startsWith('__reactContainer'))
  const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber'))
  const start = containerKey !== undefined ? rootEl[containerKey] : rootEl[fiberKey]
  const names = (fiber) => { const t = fiber.type; if (t === null || t === undefined) return ''; if (typeof t === 'string') return t; if (typeof t === 'function') return t.displayName ?? t.name ?? ''; return '' }
  const stack = [start]; const seen = new Set(); let count = 0
  const stores = new Map(); let flow = null
  while (stack.length > 0 && count < 400000) {
    const fiber = stack.pop()
    if (fiber === null || fiber === undefined || seen.has(fiber)) continue
    seen.add(fiber); count++
    const name = names(fiber); const props = fiber.memoizedProps
    if (props !== null && typeof props === 'object') {
      if (name === 'ChatFlow') flow = props.entries === undefined ? null : props.entries.length
      for (const value of Object.values(props)) {
        if (value === null || typeof value !== 'object') continue
        const own = Object.keys(value)
        if (own.includes('byKey') && own.includes('turnProcesses')) {
          const byKey = value.byKey
          const size = byKey instanceof Map ? byKey.size : Object.keys(byKey).length
          stores.set(name, size)
        }
      }
    }
    if (fiber.child !== null) stack.push(fiber.child)
    if (fiber.sibling !== null) stack.push(fiber.sibling)
  }
  return { fibers: count, flowEntries: flow, nodeStores: [...stores.entries()], dom: document.querySelectorAll('*').length, heap: performance.memory?.usedJSHeapSize ?? null }
})()
