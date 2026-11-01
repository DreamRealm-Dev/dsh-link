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
    if (typeof type === 'object') return (type.displayName ?? type._context?.displayName ?? type.render?.displayName ?? type.render?.name) ?? '(object-context)'
    return typeof type
  }
  const stack = [start]
  const seen = new Set()
  const providers = []
  const probeValue = (value, path) => {
    if (value === null || typeof value !== 'object') return null
    const has = (k) => k in value
    const isEvent = has('eventSource') || (typeof value.getSnapshot === 'function' && has('sessionId'))
    if (!isEvent) return null
    const es = value.eventSource
    let window = null
    try { window = es === undefined || es === null ? null : (() => { const s = es.getSnapshot(); return { entries: s.entries.length, hasMore: s.hasMore, revision: s.revision } })() } catch (error) { window = 'ERR ' + String(error) }
    return { path, ownKeys: Object.keys(value).slice(0, 30), sessionId: value.sessionId, window, protoKeys: Object.getOwnPropertyNames(Object.getPrototypeOf(value)).slice(0, 30) }
  }
  let count = 0
  while (stack.length > 0 && count < 400000) {
    const fiber = stack.pop()
    if (fiber === null || fiber === undefined || seen.has(fiber)) continue
    seen.add(fiber)
    count++
    const props = fiber.memoizedProps
    if (props !== null && typeof props === 'object') {
      if ('value' in props && 'children' in props) {
        const value = props.value
        const hit = probeValue(value, 'context:' + typeName(fiber))
        if (hit !== null) providers.push(hit)
        // nested session binding: value.session or value.binding
        if (value !== null && typeof value === 'object') {
          for (const key of ['session', 'binding', 'owner', 'conversation']) {
            const nested = value[key]
            const nestedHit = probeValue(nested, 'context:' + typeName(fiber) + '.' + key)
            if (nestedHit !== null) providers.push(nestedHit)
          }
        }
      }
      const direct = probeValue(props, 'props:' + typeName(fiber))
      if (direct !== null && providers.length < 60) providers.push(direct)
    }
    if (fiber.child !== null) stack.push(fiber.child)
    if (fiber.sibling !== null) stack.push(fiber.sibling)
  }
  return { fibers: count, providers: providers.slice(0, 40) }
})()
