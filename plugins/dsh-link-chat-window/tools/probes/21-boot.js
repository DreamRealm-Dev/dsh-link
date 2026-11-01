(async () => {
  const root = document.querySelector('#root')
  return {
    url: location.href,
    title: document.title,
    ready: document.readyState,
    dom: document.querySelectorAll('*').length,
    rootChildren: root === null ? null : root.childElementCount,
    bootReady: globalThis.__DSH_BOOT_READY__ === undefined ? null : typeof globalThis.__DSH_BOOT_READY__,
    boot: globalThis.__DSH_BOOT__ === undefined ? null : { rev: globalThis.__DSH_BOOT__.rev, entries: globalThis.__DSH_BOOT__.entries?.length },
    loader: globalThis.__ModuleLoader__ === undefined ? null : Object.keys(globalThis.__ModuleLoader__),
    bodyText: (document.body.innerText ?? '').slice(0, 800),
    bodyHtml: document.body.innerHTML.slice(0, 600),
    errors: [...document.querySelectorAll('[class*="error" i], [data-error]')].slice(0, 5).map(el => ({ cls: [...el.classList].join(' '), text: (el.textContent ?? '').slice(0, 200) })),
  }
})()