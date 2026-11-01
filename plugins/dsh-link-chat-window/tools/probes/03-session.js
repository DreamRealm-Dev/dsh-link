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
  const candidates = []
  const nodeSeatProps = []
  let count = 0
  while (stack.length > 0 && count < 400000) {
    const fiber = stack.pop()
    if (fiber === null || fiber === undefined || seen.has(fiber)) continue
    seen.add(fiber)
    count++
    const name = typeName(fiber)
    const props = fiber.memoizedProps
    if (props !== null && typeof props === 'object') {
      if (name === 'ChatNodeSeat' && nodeSeatProps.length < 2) {
        const record = {}
        for (const [key, value] of Object.entries(props)) {
          if (value === null || value === undefined) record[key] = value
          else if (typeof value === 'function') record[key] = 'fn'
          else if (typeof value === 'object') record[key] = '[object ' + (Array.isArray(value) ? 'array' : Object.keys(value).slice(0, 12).join(',')) + ']'
          else record[key] = value
        }
        nodeSeatProps.push({ name, record })
      }
      // direct session-ish objects
      for (const [key, value] of Object.entries(props)) {
        if (value === null || typeof value !== 'object') continue
        const isSessionish = ('sessionId' in value) && typeof value.getSnapshot === 'function'
        const isEventSource = typeof value.getSnapshot === 'function' && typeof value.subscribe === 'function' && !('sessionId' in value)
        if (isSessionish || isEventSource) {
          let snapKeys = null
          try { const s = value.getSnapshot(); snapKeys = s === null || typeof s !== 'object' ? null : Object.keys(s).slice(0, 20) } catch (error) { snapKeys = 'ERR ' + String(error) }
          candidates.push({ component: name, key, isSessionish, isEventSource, ownKeys: Object.keys(value).slice(0, 20), snapKeys })
        }
      }
    }
    if (fiber.child !== null) stack.push(fiber.child)
    if (fiber.sibling !== null) stack.push(fiber.sibling)
  }
  return { fibers: count, candidates: candidates.slice(0, 40), nodeSeatProps }
})()
