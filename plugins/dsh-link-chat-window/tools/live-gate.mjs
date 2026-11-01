#!/usr/bin/env node
/**
 * R493/R501 LIVE gate driver: runs the enabled and default-off gate on the running LINK shell page
 * over CDP. Page refresh only; the kernel process is not restarted.
 *
 * What it does:
 *   1. records the wiring state (profile row / boot manifest / global) so a not-mounted client half is
 *      visible rather than silently skipped;
 *   2. proves the built plugin client half writes the policy global (the bundle is executed against a
 *      stubbed module loader inside the live page, then its disposer is called);
 *   3. enabled pass: sets the policy global, opens the 10.65k-event Lead session, and measures the
 *      opening event-window trim, DOM/heap, loadOlder page/follow alignment, fold + trim, bottom-follow
 *      and old-page-reading and turn-jump P1 scenarios (live appends are synthetic window entries that
 *      go through the patched maintainEventWindow path - client-only, discarded by the refresh);
 *   4. default-off pass: clears the global, refreshes, opens the same session, pages the whole log in
 *      through the official loadOlder and records the stock unbounded behavior.
 *
 *   node plugins/dsh-link-chat-window/tools/live-gate.mjs [--port=9222] [--lead=session-...]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from './cdp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const HELPER_SRC = readFileSync(join(HERE, 'probes', '24-helpers.js'), 'utf8')
const BUNDLE_SRC = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8')
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find(argument => argument === name || argument.startsWith(name + '='))
  if (hit === undefined) return fallback
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : args[args.indexOf(hit) + 1]
}
const port = Number(flag('--port', '9222'))
const LEAD = flag('--lead', 'session-<example>')
const AWAY = flag('--away', 'session-<example>')
const cdp = await connect({ port })
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const overrideViewport = () => cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
const evaluate = async (expression) => cdp.evaluate(expression)
const log = (label) => { console.error('[live-gate] ' + label + ' ' + new Date().toISOString()) }
const withTimeout = (promise, timeoutMs, label) => Promise.race([
  promise,
  new Promise((resolve, reject) => setTimeout(() => reject(new Error('step timeout: ' + label)), timeoutMs)),
])
const step = async (label, expression, timeoutMs = 180000) => {
  log(label)
  const value = await withTimeout(evaluate(expression), timeoutMs, label)
  return value
}
const waitFor = async (expression, timeoutMs = 30000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try { if (await evaluate(expression) === true) return true } catch (error) { /* navigating */ }
    await sleep(250)
  }
  return false
}
const reloadAndInject = async () => {
  await cdp.call('Page.reload', { ignoreCache: false })
  await sleep(1200)
  await overrideViewport()
  const ready = await waitFor('document.readyState === \'complete\' && !!globalThis.__ModuleLoader__ && !!globalThis.__dshSessionNav && (document.querySelector(\'#root\')?.childElementCount ?? 0) > 0', 40000)
  const injected = await evaluate(HELPER_SRC)
  return { ready, injected }
}

const results = { format: 'dsh-link.chat-window-live-gate/1', startedAt: new Date().toISOString(), port, lead: LEAD, environment: {}, wiring: null, pluginClientHalf: null, enabled: null, defaultOff: null, errors: [] }

try {
  await overrideViewport()
  results.environment = await evaluate('({ url: location.href, viewport: { w: innerWidth, h: innerHeight }, title: document.title, dom: document.querySelectorAll("*").length, global: globalThis.__DSH_EVENT_WINDOW_LIMIT__ ?? null })')
  // 1) wiring state: is the row in the browser boot manifest at all?
  results.wiring = await evaluate(`(() => {
    const boot = globalThis.__DSH_BOOT__
    const entries = boot?.entries ?? []
    const mine = entries.filter(entry => JSON.stringify(entry).toLowerCase().includes('chat-window'))
    return { bootRev: boot?.rev ?? null, entryCount: entries.length, chatWindowEntries: mine, hasGlobal: globalThis.__DSH_EVENT_WINDOW_LIMIT__ ?? null }
  })()`)
  // 2) plugin client half: run the real built bundle in the page against a stubbed loader.
  results.pluginClientHalf = await evaluate(`(() => {
    const savedLoader = globalThis.__ModuleLoader__
    let registered = null
    let factory = null
    globalThis.__ModuleLoader__ = { load(definition) { registered = definition.id; factory = definition.factory } }
    try { eval(${JSON.stringify(BUNDLE_SRC)}) } finally { globalThis.__ModuleLoader__ = savedLoader }
    if (factory === null) return { error: 'bundle did not register a factory' }
    const moduleExports = factory(() => { throw new Error('client half has no runtime imports') })
    let disposer = null
    const ctx = { effect(fn) { disposer = fn(); return () => {} } }
    delete globalThis.__DSH_EVENT_WINDOW_LIMIT__
    moduleExports.apply(ctx, { enabled: false, windowEvents: 500, slackEvents: 125, trimOpeningPage: true })
    const afterDisabled = globalThis.__DSH_EVENT_WINDOW_LIMIT__ ?? null
    moduleExports.apply(ctx, { enabled: true, windowEvents: 500, slackEvents: 125, trimOpeningPage: true })
    const afterEnabled = globalThis.__DSH_EVENT_WINDOW_LIMIT__ ?? null
    if (typeof disposer === 'function') disposer()
    const afterDispose = globalThis.__DSH_EVENT_WINDOW_LIMIT__ ?? null
    return { registeredId: registered, exports: Object.keys(moduleExports), afterDisabled, afterEnabled, afterDispose }
  })()`)
  // 3) enabled pass: fresh page, policy global set before the Session opens, then the Lead session.
  log('enabled.reload');
  results.enabled = { reload: await reloadAndInject() }
  // The shell auto-restores the last selection on refresh, so the target Session may already have
  // opened (and resolved the limit as null) before the policy is set. Release it first by opening a
  // different session, then set the policy and reopen the target, forcing a fresh doOpen.
  results.enabled.openAway = await step('enabled.openAway', '__r493.openSession(' + JSON.stringify(AWAY) + ')', 60000)
  results.enabled.beforePolicy = await step('enabled.beforePolicy', '({ global: globalThis.__DSH_EVENT_WINDOW_LIMIT__ ?? null, info: __r493.windowInfo() })')
  results.enabled.gate = await step('enabled.gate', `__r493.runEnabledGate(${JSON.stringify(LEAD)})`, 240000)
  // 4) default-off pass: clear the policy, refresh, reopen, page the whole log in.
  await step('enabled.clearPolicy', '__r493.clearPolicy()', 30000)
  log('defaultOff.reload');
  results.defaultOff = { reload: await reloadAndInject() }
  results.defaultOff.beforeOpen = await step('defaultOff.beforeOpen', '({ global: globalThis.__DSH_EVENT_WINDOW_LIMIT__ ?? null, info: __r493.windowInfo() })')
  results.defaultOff.gate = await step('defaultOff.gate', `__r493.runDefaultOffGate(${JSON.stringify(LEAD)})`, 240000)
} catch (error) {
  results.errors.push(String(error && error.stack || error))
} finally {
  try { await cdp.call('Emulation.clearDeviceMetricsOverride') } catch (error) { /* target may be gone */ }
  try { await cdp.call('Page.reload', { ignoreCache: false }) } catch (error) { /* best effort clean */ }
  results.finishedAt = new Date().toISOString()
  writeFileSync(join(HERE, 'results', 'live-gate.json'), JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify(results, null, 2))
  cdp.close()
}