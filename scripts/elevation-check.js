(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  const pick = (label) => Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').trim() === label)
  const chip = () => { const b = document.querySelector('[aria-label="搜索会话"]'); return b ? getComputedStyle(b).backgroundColor : null }
  const dialog = () => !!document.querySelector('[role="dialog"]')
  const openSettings = async () => { if (!dialog()) { document.querySelector('[data-slot="settings.launcher"] button')?.click(); await wait(600); Array.from(document.querySelectorAll('[role="menuitem"], button')).find(n => (n.textContent || '').trim().startsWith('设置'))?.click(); await wait(900) } }
  const out = { darkChip: chip() }
  await openSettings()
  pick('通用设置')?.click(); await wait(700)
  pick('浅色')?.click(); await wait(1400)
  Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => (b.textContent || '').trim() === '关闭')?.click(); await wait(900)
  out.lightChip = chip()
  out.lightDark = document.body.hasAttribute('data-ds-dark-theme')
  await openSettings()
  pick('通用设置')?.click(); await wait(700)
  pick('跟随系统')?.click(); await wait(1400)
  Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => (b.textContent || '').trim() === '关闭')?.click(); await wait(900)
  out.restoredDark = document.body.hasAttribute('data-ds-dark-theme')
  out.restoredChip = chip()
  return out
})()