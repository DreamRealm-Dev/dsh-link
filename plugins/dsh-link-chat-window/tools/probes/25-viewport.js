(async () => {
  const candidates = []
  for (const element of document.querySelectorAll('*')) {
    if (element.scrollHeight > element.clientHeight + 20) candidates.push({ tag: element.tagName, cls: [...element.classList].join(' ').slice(0, 60), ch: element.clientHeight, sh: element.scrollHeight, elements: element.querySelectorAll('*').length })
  }
  candidates.sort((left, right) => right.elements - left.elements)
  return { viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, candidates: candidates.slice(0, 8), visibility: document.visibilityState }
})()