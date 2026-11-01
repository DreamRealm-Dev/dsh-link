(async () => {
  const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
  const twoFrames = async () => { await frame(); await frame() }
  const dom = () => document.querySelectorAll('*').length
  // Count chat nodes from the live fiber props (nodeStore.byKey), read-only.
  const rootEl = document.querySelector('#root') ?? document.body.firstElementChild
  const containerKey = Object.keys(rootEl).find(k => k.startsWith('__reactContainer'))
  const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber'))
  const start = containerKey !== undefined ? rootEl[containerKey] : rootEl[fiberKey]
  const names = (fiber) => { const t = fiber.type; if (t === null || t === undefined) return ''; if (typeof t === 'string') return t; if (typeof t === 'function') return t.displayName ?? t.name ?? ''; return '' }
  const countNodes = () => {
    const stack = [start]; const seen = new Set(); let count = 0; let nodes = 0
    while (stack.length > 0 && count < 200000) {
      const fiber = stack.pop()
      if (fiber === null || fiber === undefined || seen.has(fiber)) continue
      seen.add(fiber); count++
      const props = fiber.memoizedProps
      if (props !== null && typeof props === 'object' && names(fiber) === 'ChatNodeSeat' && props.nodeStore !== null && nodes === 0) {
        const byKey = props.nodeStore.byKey
        nodes = byKey instanceof Map ? byKey.size : Object.keys(byKey).length
      }
      if (fiber.child !== null) stack.push(fiber.child)
      if (fiber.sibling !== null) stack.push(fiber.sibling)
    }
    return nodes
  }
  const buttons = [...document.querySelectorAll('button[aria-expanded="false"]')]
    .filter(button => button.closest('[class*="scrollBody"]') !== null || button.closest('[style*="overflow"]') !== null || button.offsetParent !== null)
  const target = buttons.find(button => button.closest('[class*="scrollBody"]') !== null) ?? buttons[0]
  if (target === undefined) return { error: 'no fold button' }
  const samples = []
  for (let index = 0; index < 3; index += 1) {
    await twoFrames()
    const t0 = performance.now()
    target.click()
    await twoFrames()
    const t1 = performance.now()
    target.click()
    await twoFrames()
    samples.push(Number((t1 - t0).toFixed(2)))
  }
  return { dom: dom(), nodes: countNodes(), samples, median: samples.slice().sort((a, b) => a - b)[1] }
})()
