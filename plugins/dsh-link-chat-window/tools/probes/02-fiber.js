(async () => {
  const rootEl = document.querySelector('#root') ?? document.body.firstElementChild
  if (rootEl === null) return { error: 'no root element' }
  const containerKey = Object.keys(rootEl).find(k => k.startsWith('__reactContainer'))
  const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber'))
  const start = containerKey !== undefined ? rootEl[containerKey] : rootEl[fiberKey]
  if (start === null || start === undefined) return { error: 'no fiber', reactKeys: Object.keys(rootEl).filter(k => k.startsWith('__react')) }
  const typeName = (fiber) => {
    const type = fiber.type
    if (type === null || type === undefined) return '(null)'
    if (typeof type === 'string') return type
    if (typeof type === 'function') return type.displayName ?? type.name ?? '(anonymous)'
    if (typeof type === 'object') return type.displayName ?? type.render?.displayName ?? type.render?.name ?? type._context?.displayName ?? '(object)'
    return typeof type
  }
  const parentName = (fiber) => {
    let up = fiber.return
    for (let i = 0; i < 4 && up !== null; i++) up = up.return
    return up === null ? null : typeName(up)
  }
  const types = new Map()
  const propsWithSource = new Map()
  const contextProviders = new Map()
  const interesting = []
  let count = 0
  let fiber = start
  const stack = [start]
  const seen = new Set()
  while (stack.length > 0 && count < 400000) {
    fiber = stack.pop()
    if (fiber === null || fiber === undefined || seen.has(fiber)) continue
    seen.add(fiber)
    count++
    const name = typeName(fiber)
    types.set(name, (types.get(name) ?? 0) + 1)
    if (fiber.memoizedProps !== null && typeof fiber.memoizedProps === 'object') {
      const props = fiber.memoizedProps
      // React context provider: { value, children }
      if ('value' in props && 'children' in props) {
        const v = props.value
        if (v !== null && typeof v === 'object') {
          const keys = Object.keys(v)
          const tag = name + ' :: ' + (fiber.type?._context?.displayName ?? fiber.type?.displayName ?? '?')
          contextProviders.set(tag, { keys, hasSnapshot: typeof v.getSnapshot === 'function', hasSubscribe: typeof v.subscribe === 'function', attr: fiber._debugOwner === null ? null : undefined })
        }
      }
      for (const [key, value] of Object.entries(props)) {
        if (value !== null && typeof value === 'object' && typeof value.getSnapshot === 'function' && typeof value.subscribe === 'function') {
          const tag = key + ' @ ' + name
          if (!propsWithSource.has(tag)) {
            let snapshot = null
            try {
              const s = value.getSnapshot()
              snapshot = s === null || typeof s !== 'object' ? { value: s } : { keys: Object.keys(s).slice(0, 20) }
            } catch (error) { snapshot = { error: String(error) } }
            propsWithSource.set(tag, { propsKey: key, component: name, parent: parentName(fiber), snapshot })
          }
        }
      }
    }
    if (fiber.child !== null) stack.push(fiber.child)
    if (fiber.sibling !== null) stack.push(fiber.sibling)
  }
  const top = [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 90)
  const componentish = top.filter(([n]) => /^[A-Z]/.test(n))
  const contexts = [...contextProviders.entries()].slice(0, 60)
  return {
    fibers: count,
    topTypes: top,
    componentTypes: componentish,
    contextProviders: contexts,
    sources: [...propsWithSource.entries()].slice(0, 40),
  }
})()
