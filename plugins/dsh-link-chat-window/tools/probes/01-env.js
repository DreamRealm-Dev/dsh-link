(async () => {
  const out = {
    url: location.href,
    title: document.title,
    ready: document.readyState,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    totalElements: document.querySelectorAll('*').length,
    bootKeys: window.__DSH_BOOT__ === undefined ? null : Object.keys(window.__DSH_BOOT__),
    loaderKeys: window.__ModuleLoader__ === undefined ? null : Object.keys(window.__ModuleLoader__),
    transportKeys: window.__DSH_TRANSPORT__ === undefined ? null : Object.keys(window.__DSH_TRANSPORT__),
  }
  const classCounts = new Map()
  for (const el of document.querySelectorAll('*')) {
    for (const cls of el.classList) classCounts.set(cls, (classCounts.get(cls) ?? 0) + 1)
  }
  out.classCounts = [...classCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)
  const scroll = []
  for (const el of document.querySelectorAll('*')) {
    const st = el.scrollHeight, ch = el.clientHeight
    if (ch > 150 && st > ch * 1.5) scroll.push({ tag: el.tagName, cls: [...el.classList].join(' ').slice(0, 120), ch, st, rows: el.childElementCount })
  }
  out.scrollContainers = scroll.sort((a, b) => b.st - a.st).slice(0, 12)
  const fiberKeys = new Set()
  for (const el of document.querySelectorAll('*')) for (const k of Object.keys(el)) if (k.startsWith('__react')) fiberKeys.add(k.split('$')[0])
  out.reactKeyPrefixes = [...fiberKeys]
  return out
})()
