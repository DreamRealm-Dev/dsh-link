(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  const pick = (label) => Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').trim() === label)
  if (!document.querySelector('[role="dialog"]')) {
    document.querySelector('[data-slot="settings.launcher"] button')?.click()
    await wait(600)
    Array.from(document.querySelectorAll('[role="menuitem"], button')).find(n => (n.textContent || '').trim().startsWith('设置'))?.click()
    await wait(900)
  }
  pick('通用设置')?.click()
  await wait(700)
  pick('跟随系统')?.click()
  await wait(1400)
  Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => (b.textContent || '').trim() === '关闭')?.click()
  await wait(900)
  return { themeSource: document.documentElement.getAttribute('data-ds-theme-source'), dark: document.body.hasAttribute('data-ds-dark-theme'), style: document.documentElement.getAttribute('data-lg-style') }
})()