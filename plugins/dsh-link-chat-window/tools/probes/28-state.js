(async () => {
  const out = { url: location.href, title: document.title, dom: document.querySelectorAll('*').length, hasHelpers: typeof globalThis.__r493 !== 'undefined', global: globalThis.__DSH_EVENT_WINDOW_LIMIT__ ?? null }
  if (out.hasHelpers) { try { out.info = __r493.windowInfo(); out.viewport = { w: innerWidth, h: innerHeight } } catch (error) { out.infoError = String(error) } }
  return out
})()