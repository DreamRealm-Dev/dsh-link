(async () => {
  const out = { globalPolicy: globalThis.__DSH_EVENT_WINDOW_LIMIT__ ?? null, title: document.title, dom: document.querySelectorAll('*').length }
  const rootEl = document.querySelector('#root') ?? document.body.firstElementChild
  const containerKey = Object.keys(rootEl).find(k => k.startsWith('__reactContainer'))
  const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber'))
  const start = containerKey !== undefined ? rootEl[containerKey] : rootEl[fiberKey]
  const names = (fiber) => { const t = fiber.type; if (t === null || t === undefined) return ''; if (typeof t === 'string') return t; if (typeof t === 'function') return t.displayName ?? t.name ?? ''; return typeof t === 'object' ? (t.displayName ?? t._context?.displayName ?? '') : '' }
  const stack = [start]
  const seen = new Set()
  const ctxCandidates = []
  const values = []
  let chatView = null
  let count = 0
  while (stack.length > 0 && count < 200000) {
    const fiber = stack.pop()
    if (fiber === null || fiber === undefined || seen.has(fiber)) continue
    seen.add(fiber)
    count += 1
    const name = names(fiber)
    const props = fiber.memoizedProps
    if (props !== null && typeof props === 'object') {
      if (name === 'ChatView') chatView = props
      if ('value' in props && 'children' in props) {
        const value = props.value
        if (value !== null && typeof value === 'object') {
          const keys = Object.keys(value)
          values.push({ provider: name, keys: keys.slice(0, 12) })
          if (value.ctx !== undefined && typeof value.ctx === 'object') {
            let sessions = null
            try { sessions = value.ctx.get('sessions') } catch (error) { sessions = 'ERR ' + String(error) }
            ctxCandidates.push({ provider: name, bindingKeys: keys.slice(0, 12), hasCtx: true, sessions: sessions === null ? null : (typeof sessions === 'object' ? 'service:' + Object.keys(sessions).slice(0, 6) : String(sessions)) })
          }
        }
      }
    }
    if (fiber.child !== null) stack.push(fiber.child)
    if (fiber.sibling !== null) stack.push(fiber.sibling)
  }
  out.fibers = count
  out.sessionId = chatView === null ? null : chatView.sessionId
  out.values = values.slice(0, 15)
  out.ctxCandidates = ctxCandidates.slice(0, 10)
  return out
})()
