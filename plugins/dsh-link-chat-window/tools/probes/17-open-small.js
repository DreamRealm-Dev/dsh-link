(async () => {
  const ok = window.__dshSessionNav.openSession('session-<example>')
  await new Promise(r => setTimeout(r, 5000))
  return { ok, title: document.title, dom: document.querySelectorAll('*').length }
})()