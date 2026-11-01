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
  const samples = []
  let count = 0
  while (stack.length > 0 && count < 400000) {
    const fiber = stack.pop()
    if (fiber === null || fiber === undefined || seen.has(fiber)) continue
    seen.add(fiber)
    count++
    const name = typeName(fiber)
    const props = fiber.memoizedProps
    if (name === 'SessionEntry' && props !== null && typeof props === 'object' && samples.length < 3) {
      const b = props.binding
      samples.push({
        bindingType: typeof b,
        bindingOwnKeys: b === null || typeof b !== 'object' ? null : Object.keys(b),
        bindingProtoKeys: b === null || typeof b !== 'object' ? null : Object.getOwnPropertyNames(Object.getPrototypeOf(b)),
        eventSource: b !== null && typeof b === 'object' ? {
          type: typeof b.eventSource,
          ownKeys: b.eventSource === null || b.eventSource === undefined ? null : Object.keys(b.eventSource),
          protoKeys: b.eventSource === null || b.eventSource === undefined ? null : Object.getOwnPropertyNames(Object.getPrototypeOf(b.eventSource)),
          hasGetSnapshot: b.eventSource !== null && b.eventSource !== undefined && typeof b.eventSource.getSnapshot === 'function',
        } : null,
        entryKeys: props.entry !== null && typeof props.entry === 'object' ? Object.keys(props.entry) : typeof props.entry,
      })
    }
    if (fiber.child !== null) stack.push(fiber.child)
    if (fiber.sibling !== null) stack.push(fiber.sibling)
  }
  return { fibers: count, samples }
})()
