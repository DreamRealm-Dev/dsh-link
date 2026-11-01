(async () => {
  const rootEl = document.querySelector('#root') ?? document.body.firstElementChild
  const containerKey = Object.keys(rootEl).find(k => k.startsWith('__reactContainer'))
  const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber'))
  const start = containerKey !== undefined ? rootEl[containerKey] : rootEl[fiberKey]
  const names = (fiber) => { const t = fiber.type; if (t === null || t === undefined) return ''; if (typeof t === 'string') return t; if (typeof t === 'function') return t.displayName ?? t.name ?? ''; return '' }
  const stack = [start]
  const seen = new Set()
  let chatView = null
  let sessions = null
  const errors = []
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
      if (sessions === null && 'value' in props && 'children' in props) {
        const value = props.value
        if (value !== null && typeof value === 'object' && value.ctx !== undefined && typeof value.ctx.get === 'function') {
          try {
            const service = value.ctx.get('sessions')
            if (service !== null && service !== undefined && typeof service.binding === 'function') sessions = service
          } catch (error) { errors.push(String(error)) }
        }
      }
    }
    if (fiber.child !== null) stack.push(fiber.child)
    if (fiber.sibling !== null) stack.push(fiber.sibling)
  }
  const out = { fibers: count, sessionId: chatView === null ? null : chatView.sessionId, gotSessions: sessions !== null, errors }
  if (sessions !== null && out.sessionId !== undefined) {
    const binding = sessions.binding(out.sessionId)
    out.bindingFound = binding !== undefined
    if (binding !== undefined) {
      const window = binding.eventSource.getSnapshot()
      out.window = { entries: window.entries.length, hasMore: window.hasMore, revision: window.revision, firstSeq: window.entries[0]?.event.seq, lastSeq: window.entries[window.entries.length - 1]?.event.seq }
      const sessionSnapshot = binding.session.getSnapshot()
      out.sessionSnapshotKeys = Object.keys(sessionSnapshot).slice(0, 30)
      out.sessionHasMore = sessionSnapshot.hasMore
      out.sessionOpenState = sessionSnapshot.openState
      out.private = { baseSeq: binding.session.baseSeq, windowLimit: binding.session.windowLimit, prototypeHasMaintain: typeof binding.session.maintainEventWindow, prototypeHasTrimOpening: typeof binding.session.trimOpeningWindow }
      out.eventSourceHasTrim = typeof binding.eventSource.trimToTail
      // expose a small helper for the remaining gate steps
      globalThis.__r493 = {
        getBinding() { const live = sessions.binding(out.sessionId); return live },
        windowInfo() {
          const live = sessions.binding(out.sessionId)
          if (live === undefined) return null
          const w = live.eventSource.getSnapshot()
          return { entries: w.entries.length, hasMore: w.hasMore, revision: w.revision, firstSeq: w.entries[0]?.event.seq, lastSeq: w.entries[w.entries.length - 1]?.event.seq, baseSeq: live.session.baseSeq, sessionHasMore: live.session.getSnapshot().hasMore, loadingOlder: live.session.getSnapshot().loadingOlder }
        },
        appendSynthetic(count, maintain = true) {
          const live = sessions.binding(out.sessionId)
          if (live === undefined) return null
          const window = live.eventSource.getSnapshot()
          let last = window.entries[window.entries.length - 1]?.event.seq ?? 0
          const before = live.eventSource.getSnapshot().entries.length
          for (let index = 0; index < count; index += 1) {
            last += 1
            live.eventSource.append({ type: 'event', event: { seq: last, type: 'system/message', time: Date.now(), data: {} } })
          }
          if (maintain) live.session.maintainEventWindow()
          const after = live.eventSource.getSnapshot().entries.length
          return { before, after, lastSeq: last, baseSeq: live.session.baseSeq, hasMore: live.session.getSnapshot().hasMore }
        },
      }
    }
  }
  return out
})()