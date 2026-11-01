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
  const components = new Map()
  const stores = new Map()
  let count = 0
  while (stack.length > 0 && count < 400000) {
    const fiber = stack.pop()
    if (fiber === null || fiber === undefined || seen.has(fiber)) continue
    seen.add(fiber)
    count++
    const name = typeName(fiber)
    const props = fiber.memoizedProps
    if (props !== null && typeof props === 'object') {
      if (/Chat|Conversation|Session|Timeline|Transcript/.test(name)) {
        const entry = components.get(name) ?? { count: 0, propKeySets: new Map() }
        entry.count++
        const keys = Object.keys(props).sort().join(',')
        entry.propKeySets.set(keys, (entry.propKeySets.get(keys) ?? 0) + 1)
        components.set(name, entry)
      }
      for (const [key, value] of Object.entries(props)) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
        const own = Object.keys(value)
        if (own.includes('byKey') && own.includes('turnProcesses')) {
          const tag = name + '.' + key
          if (!stores.has(tag)) {
            const byKey = value.byKey
            const mapKeys = byKey instanceof Map ? [...byKey.keys()].slice(0, 12) : (byKey !== null && typeof byKey === 'object' ? Object.keys(byKey).slice(0, 12) : null)
            const size = byKey instanceof Map ? byKey.size : (mySize(byKey))
            stores.set(tag, { name, key, ownKeys: own, byKeySize: size, sample: mapKeys, turnProcesses: value.turnProcesses instanceof Map ? value.turnProcesses.size : (mySize(value.turnProcesses)) })
          }
        }
      }
    }
    if (fiber.child !== null) stack.push(fiber.child)
    if (fiber.sibling !== null) stack.push(fiber.sibling)
  }
  function mySize(value) {
    if (value === null || value === undefined) return null
    if (value instanceof Map || value instanceof Set) return value.size
    if (typeof value === 'object') return Object.keys(value).length
    return null
  }
  return {
    fibers: count,
    components: [...components.entries()].map(([name, entry]) => ({ name, count: entry.count, propKeySets: [...entry.propKeySets.entries()].slice(0, 6) })).sort((a, b) => b.count - a.count).slice(0, 50),
    nodeStores: [...stores.entries()],
  }
})()
