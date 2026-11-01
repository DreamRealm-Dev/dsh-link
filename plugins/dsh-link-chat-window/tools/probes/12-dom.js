(async () => {
  const scrollers = []
  for (const el of document.querySelectorAll('*')) {
    const st = el.scrollHeight, ch = el.clientHeight
    if (ch > 200 && st > ch + 40) scrollers.push({ tag: el.tagName, cls: [...el.classList].join(' ').slice(0, 90), ch, st, children: el.childElementCount, elements: el.querySelectorAll('*').length })
  }
  scrollers.sort((a, b) => b.elements - a.elements)
  const classes = new Map()
  for (const el of document.querySelectorAll('*')) for (const c of el.classList) classes.set(c, (classes.get(c) ?? 0) + 1)
  return {
    scrollers: scrollers.slice(0, 10),
    topClasses: [...classes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 45),
    total: document.querySelectorAll('*').length,
  }
})()
