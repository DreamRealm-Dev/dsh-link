JSON.stringify({
  style: document.documentElement.getAttribute('data-lg-style'),
  dark: document.body.hasAttribute('data-ds-dark-theme'),
  materialTag: !!document.querySelector('style[data-plugin-css="dsh-liquid-glass/liquid-glass"]'),
  filter: !!document.querySelector('filter[id^="dsh-lg-refract"]'),
  dialogOpen: document.querySelector('[role="dialog"]') !== null,
})