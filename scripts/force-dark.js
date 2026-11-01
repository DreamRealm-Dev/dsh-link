(() => {
  if (!document.body.hasAttribute('data-ds-dark-theme')) document.body.setAttribute('data-ds-dark-theme', '')
  return { light: !document.body.hasAttribute('data-ds-dark-theme'), style: document.documentElement.getAttribute('data-lg-style') }
})()