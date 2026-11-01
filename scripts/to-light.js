(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  const pick = (label) => Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').trim() === label)
  if (!document.querySelector('[role="dialog"]')) {
    document.querySelector('[data-slot="settings.launcher"] button')?.click()
    await wait(600)
    Array.from(document.querySelectorAll('[role="menuitem"], button')).find(n => (n.textContent || '').trim().startsWith('设置'))?.click()
    await wait(900)
  }
  pick('通用设置')?.click(); await wait(700)
  pick('浅色')?.click(); await wait(1400)
  Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => (b.textContent || '').trim() === '关闭')?.click()
  await wait(900)
  const panel = document.querySelector('[data-slot="sidebar"] > *')
  const pr = panel.getBoundingClientRect()
  const fade = Array.from(document.querySelectorAll('[class*="fade"]')).find(n => n.getBoundingClientRect().height > 4 && n.getBoundingClientRect().width > 100)
  const fr = fade ? fade.getBoundingClientRect() : null
  return {
    light: !document.body.hasAttribute('data-ds-dark-theme'),
    viewport: [innerWidth, innerHeight],
    panel: [Math.round(pr.y), Math.round(pr.bottom)],
    fade: fr ? [Math.round(fr.y), Math.round(fr.bottom)] : null,
    panelFill: getComputedStyle(panel).backgroundColor,
    panelImage: getComputedStyle(panel).backgroundImage.slice(0, 120),
    specular: getComputedStyle(panel).getPropertyValue('--lg-specular').trim(),
    veil: getComputedStyle(panel).getPropertyValue('--lg-veil').trim(),
  }
})()