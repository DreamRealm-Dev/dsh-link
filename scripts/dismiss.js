(() => {
  const close = Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => (b.textContent || '').trim() === '关闭')
  if (close) close.click()
  else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  const overlay = document.querySelector('[class*="overlay"][role="presentation"]')
  return { clicked: !!close, overlayBg: overlay ? getComputedStyle(overlay).backgroundColor : 'none' }
})()