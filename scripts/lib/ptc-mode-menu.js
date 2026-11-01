(async () => {
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
  const visible = (node) => {
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  const label = (node) => String(node.textContent ?? '').replace(/\s+/g, ' ').trim()
  // A PTC session renders its preset as a header label; a standard one offers a switcher button.
  const ptcLabel = [...document.querySelectorAll('span, div, button')].find((node) => visible(node) && label(node) === 'PTC 模式')
  if (ptcLabel !== undefined) return { found: true, source: 'header-label', chip: 'PTC 模式', text: 'PTC 模式' }
  const chip = [...document.querySelectorAll('button, [role="button"]')].find((node) => visible(node) && label(node).length > 0 && label(node).length < 40 && label(node).includes('模式'))
  if (chip === undefined) return { found: false, source: 'none', labels: [...document.querySelectorAll('button')].filter(visible).map(label).slice(0, 10) }
  chip.click()
  await sleep(600)
  const menus = [...document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"],[class*="popover" i],[class*="Popover"],[class*="menu" i],[class*="dropdown" i]')].filter(visible)
  const text = menus.map(label).join(' ')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
  return { found: true, source: 'switcher', chip: label(chip), text }
})()
