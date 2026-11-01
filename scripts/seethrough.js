(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  if (document.body.hasAttribute('data-ds-dark-theme')) { document.body.removeAttribute('data-ds-dark-theme'); await wait(700) }
  if (!document.querySelector('[role="dialog"]')) {
    document.querySelector('[data-slot="settings.launcher"] button')?.click()
    await wait(600)
    Array.from(document.querySelectorAll('[role="menuitem"], button')).find(n => (n.textContent || '').trim().startsWith('设置'))?.click()
    await wait(1200)
  }
  // The Theme section leaves the dialog's content column empty, so a sample row
  // there sees only the backdrop.
  Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => (b.textContent || '').trim() === '主题')?.click()
  await wait(800)
  const dialog = document.querySelector('[role="dialog"]')
  const d = dialog.getBoundingClientRect()
  // Two backdrop rows with different content: one crossing a text line, one in a gap.
  const blocks = Array.from(document.querySelectorAll('[data-slot="conversation.chat.node"] p, [data-slot="conversation.chat.node"] li, [data-slot="conversation.chat.node"] pre'))
    .map(n => n.getBoundingClientRect())
    .filter(r => r.height > 8 && r.left < 700 && r.right > 700)
    .sort((a, b) => a.top - b.top)
  const text = blocks.find(r => r.top > d.top + 120 && r.bottom < d.bottom - 120 && r.left < 600 && r.right > 700)
  const gap = blocks.find((r, i) => i > 0 && r.top > d.top + 120 && r.bottom < d.bottom - 120 && r.top - blocks[i - 1].bottom > 14 && r.left < 600 && r.right > 700)
  return {
    light: !document.body.hasAttribute('data-ds-dark-theme'),
    dialogBox: [Math.round(d.x), Math.round(d.y), Math.round(d.width), Math.round(d.height)],
    blur: getComputedStyle(dialog).backdropFilter,
    overText: text ? Math.round(text.top + text.height / 2) : null,
    overGap: gap ? Math.round(gap.top - 7) : null,
    sampleClip: '600,y,300,1',
  }
})()