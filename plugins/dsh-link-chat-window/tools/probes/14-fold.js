(async () => {
  const scroller = () => [...document.querySelectorAll('*')].find(el => el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 400)
  const measure = () => {
    const s = scroller()
    return { dom: document.querySelectorAll('*').length, chatDom: s === undefined ? null : s.querySelectorAll('*').length, visibleButtons: [...document.querySelectorAll('button')].length }
  }
  const before = measure()
  // Find fold triggers: buttons whose aria-expanded is set, inside the chat scroller.
  const s = scroller()
  const scope = s ?? document
  const candidates = [...scope.querySelectorAll('button[aria-expanded]')].slice(0, 12)
  const samples = candidates.slice(0, 5).map(button => ({ aria: button.getAttribute('aria-expanded'), text: (button.textContent ?? '').trim().slice(0, 60), cls: [...button.classList].join(' ') }))
  // Toggle every collapsed candidate open, then closed again, measuring the DOM each way.
  const toggles = []
  for (const button of candidates) {
    if (button.getAttribute('aria-expanded') !== 'false') continue
    const domBefore = document.querySelectorAll('*').length
    button.click()
    await new Promise(resolve => setTimeout(resolve, 120))
    const domOpen = document.querySelectorAll('*').length
    button.click()
    await new Promise(resolve => setTimeout(resolve, 120))
    const domClosed = document.querySelectorAll('*').length
    toggles.push({ domBefore, domOpen, domClosed, deltaOpen: domOpen - domBefore, deltaClosed: domClosed - domBefore })
    if (toggles.length >= 3) break
  }
  const after = measure()
  return { before, after, candidateCount: candidates.length, samples, toggles, heap: performance.memory === undefined ? null : performance.memory.usedJSHeapSize }
})()
