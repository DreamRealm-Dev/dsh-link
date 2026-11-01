(async () => {
  const boot = globalThis.__DSH_BOOT__
  const entries = boot?.entries ?? []
  const mine = entries.filter(entry => JSON.stringify(entry).toLowerCase().includes('chat-window'))
  return { rev: boot?.rev, count: entries.length, mine, firstIds: entries.slice(0, 6).map(e => e.id), global: globalThis.__DSH_EVENT_WINDOW_LIMIT__ ?? null, dom: document.querySelectorAll('*').length }
})()