(async () => {
  const bridge = window.__dshSessionNav
  if (bridge === undefined) return { error: '__dshSessionNav missing' }
  const ok = bridge.openSession('session-<example>')
  await new Promise(r => setTimeout(r, 6000))
  return { ok, title: document.title, nodes: document.querySelectorAll('*').length }
})()