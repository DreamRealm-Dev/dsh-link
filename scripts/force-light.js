(() => {
  if (document.body.hasAttribute('data-ds-dark-theme')) document.body.removeAttribute('data-ds-dark-theme')
  return { light: !document.body.hasAttribute('data-ds-dark-theme') }
})()